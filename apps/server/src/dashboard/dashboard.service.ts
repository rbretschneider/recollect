import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { detectClusters, ClusterInput } from '../memories/event-clustering';

type MediaType = 'image' | 'video';

/** One coherent "moment" surfaced on the home page for around today's date. */
export interface OnThisDayMoment {
  /** Stable key for client tracking. */
  key: string;
  kind: 'memory' | 'place' | 'person';
  /** The past year this moment is from. */
  year: number;
  /** Headline: a memory title, a place name, or "With Mom". */
  title: string;
  /** Secondary line: place, people, or a plain date. */
  subtitle: string | null;
  /** Set for memory moments so the card can link straight to the memory. */
  memoryId: string | null;
  /** Set for person moments so the card can link to that person. */
  personId: string | null;
  coverAssetId: string;
  items: Array<{ id: string; mediaType: MediaType }>;
}

/** How many days either side of the exact date count as "around this day". */
const WINDOW_RADIUS_DAYS = 3;
const TINY_IMAGE_BYTES = 32 * 1024;
const CANDIDATE_LIMIT = 3000;
/** A place cluster this small is only kept if a named person is in it. */
const MIN_PLACE_CLUSTER = 3;
/** Minimum photos of one person (in a year's window) to earn a person card. */
const MIN_PERSON_PHOTOS = 3;
const MAX_MOMENTS = 14;

interface Candidate {
  id: string;
  mediaType: MediaType;
  year: number;
  capturedAt: Date;
  gpsLat: number | null;
  gpsLon: number | null;
  place: string | null;
}

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * "On this day" reimagined as moments, not a flat pile: existing Memories
   * that fall on this date win first, loose photos are clustered by place and
   * time into mini-moments, and each named person who shows up gets a "with
   * them" card. Accidental/tiny/damaged shots are filtered out. Ranked so the
   * most memorable moment leads.
   */
  async onThisDayMoments(day: string, nowYear: number): Promise<OnThisDayMoment[]> {
    const days = windowDays(day, WINDOW_RADIUS_DAYS);
    const candidates = await this.loadCandidates(days);
    if (candidates.length === 0) {
      return [];
    }
    const ids = candidates.map((candidate) => candidate.id);
    const [people, memberships] = await Promise.all([
      this.loadPeople(ids),
      this.loadMemoryMemberships(ids),
    ]);

    const moments: OnThisDayMoment[] = [];
    const claimed = new Set<string>();

    // 1) Memory moments — an already-curated story wins over anything derived.
    const byMemory = new Map<
      string,
      { title: string; year: number; cover: string | null; items: Candidate[] }
    >();
    for (const candidate of candidates) {
      const memory = memberships.get(candidate.id);
      if (!memory) {
        continue;
      }
      claimed.add(candidate.id);
      const group = byMemory.get(memory.memoryId) ?? {
        title: memory.title,
        year: memory.year,
        cover: memory.coverAssetId,
        items: [],
      };
      group.items.push(candidate);
      byMemory.set(memory.memoryId, group);
    }
    for (const [memoryId, group] of byMemory) {
      moments.push({
        key: `memory:${memoryId}`,
        kind: 'memory',
        year: group.year,
        title: group.title,
        subtitle: mostCommonPlace(group.items),
        memoryId,
        personId: null,
        coverAssetId: group.cover ?? group.items[0].id,
        items: group.items.map(toItem),
      });
    }

    // 2) Place + time clusters over the leftover loose photos, per year.
    const looseByYear = new Map<number, Candidate[]>();
    for (const candidate of candidates) {
      if (claimed.has(candidate.id)) {
        continue;
      }
      const list = looseByYear.get(candidate.year) ?? [];
      list.push(candidate);
      looseByYear.set(candidate.year, list);
    }
    for (const [year, yearItems] of looseByYear) {
      const inputs: ClusterInput[] = yearItems
        .slice()
        .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
        .map((candidate) => ({
          id: candidate.id,
          capturedAt: candidate.capturedAt,
          gpsLat: candidate.gpsLat,
          gpsLon: candidate.gpsLon,
        }));
      // minClusterSize 1 so we get every segment; we apply our own keep rule
      // (size, or a named person present) below.
      const clusters = detectClusters(inputs, {
        maxGapHours: this.config.clusterMaxGapHours,
        maxJumpKm: this.config.clusterMaxJumpKm,
        minClusterSize: 1,
      });
      const byId = new Map(yearItems.map((candidate) => [candidate.id, candidate]));
      for (const cluster of clusters) {
        const members = cluster.assetIds.map((id) => byId.get(id)!).filter(Boolean);
        const names = uniqueNames(members, people);
        if (members.length < MIN_PLACE_CLUSTER && names.length === 0) {
          continue; // A stray shot or two — not a moment.
        }
        const place = mostCommonPlace(members);
        moments.push({
          key: `place:${year}:${members[0].id}`,
          kind: 'place',
          year,
          title: place ?? 'Around this day',
          subtitle: names.length > 0 ? withPeople(names) : place ? null : null,
          memoryId: null,
          personId: null,
          coverAssetId: members[0].id,
          items: members.map(toItem),
        });
      }
    }

    // 3) Person moments — "With Mom", per person per year (overlap is fine; a
    // face-first lens on the same day reads differently from the place lens).
    const byPersonYear = new Map<string, { name: string; personId: string; year: number; items: Candidate[] }>();
    for (const candidate of candidates) {
      for (const person of people.get(candidate.id) ?? []) {
        const key = `${person.personId}:${candidate.year}`;
        const group = byPersonYear.get(key) ?? {
          name: person.name,
          personId: person.personId,
          year: candidate.year,
          items: [],
        };
        group.items.push(candidate);
        byPersonYear.set(key, group);
      }
    }
    for (const [key, group] of byPersonYear) {
      if (group.items.length < MIN_PERSON_PHOTOS) {
        continue;
      }
      moments.push({
        key: `person:${key}`,
        kind: 'person',
        year: group.year,
        title: `With ${group.name}`,
        subtitle: mostCommonPlace(group.items),
        memoryId: null,
        personId: group.personId,
        coverAssetId: group.items[0].id,
        items: group.items.map(toItem),
      });
    }

    return moments
      .map((moment) => ({ moment, score: scoreMoment(moment) }))
      .sort((a, b) => b.score - a.score || b.moment.year - a.moment.year)
      .slice(0, MAX_MOMENTS)
      .map((entry) => entry.moment);
  }

  private async loadCandidates(days: string[]): Promise<Candidate[]> {
    const result = await this.db.execute<{
      id: string;
      media_type: MediaType;
      year: number;
      captured_at: string;
      gps_lat: number | null;
      gps_lon: number | null;
      place: string | null;
      size_bytes: number;
      stage_errors: Record<string, string> | null;
    }>(sql`
      select a.id, a.media_type,
             extract(year from a.captured_day)::int as year,
             a.captured_at, a.gps_lat, a.gps_lon,
             g.label as place, f.size_bytes, a.stage_errors
      from asset a
      join asset_file f on f.asset_id = a.id and f.state = 'present'
      left join geocode_cache g on g.cell_key = a.geocode_cell_key
      where a.status = 'active'
        and to_char(a.captured_day, 'MM-DD') = any(${days}::text[])
      order by a.captured_at asc
      limit ${CANDIDATE_LIMIT}
    `);
    return result.rows
      .filter((row) => {
        // Drop the obvious non-photos so a moment never leads with junk.
        if (Number(row.size_bytes) === 0) return false;
        if (row.media_type === 'image' && Number(row.size_bytes) < TINY_IMAGE_BYTES) return false;
        if (row.media_type === 'video' && row.stage_errors?.['playback']) return false;
        return true;
      })
      .map((row) => ({
        id: row.id,
        mediaType: row.media_type,
        year: Number(row.year),
        capturedAt: new Date(row.captured_at),
        gpsLat: row.gps_lat === null ? null : Number(row.gps_lat),
        gpsLon: row.gps_lon === null ? null : Number(row.gps_lon),
        place: row.place,
      }));
  }

  private async loadPeople(
    ids: string[],
  ): Promise<Map<string, Array<{ personId: string; name: string }>>> {
    const map = new Map<string, Array<{ personId: string; name: string }>>();
    if (ids.length === 0) {
      return map;
    }
    const result = await this.db.execute<{ asset_id: string; person_id: string; name: string }>(sql`
      select distinct f.asset_id, p.id as person_id, p.name
      from face f join person p on p.id = f.person_id
      where p.name is not null and f.asset_id = any(${ids}::uuid[])
    `);
    for (const row of result.rows) {
      const list = map.get(row.asset_id) ?? [];
      list.push({ personId: row.person_id, name: row.name });
      map.set(row.asset_id, list);
    }
    return map;
  }

  private async loadMemoryMemberships(
    ids: string[],
  ): Promise<Map<string, { memoryId: string; title: string; year: number; coverAssetId: string | null }>> {
    const map = new Map<
      string,
      { memoryId: string; title: string; year: number; coverAssetId: string | null }
    >();
    if (ids.length === 0) {
      return map;
    }
    const result = await this.db.execute<{
      asset_id: string;
      memory_id: string;
      title: string;
      year: number;
      cover_asset_id: string | null;
    }>(sql`
      select ma.asset_id, m.id as memory_id, m.title,
             extract(year from m.start_at)::int as year, m.cover_asset_id
      from memory_asset ma join memory m on m.id = ma.memory_id
      where ma.asset_id = any(${ids}::uuid[])
    `);
    for (const row of result.rows) {
      if (!map.has(row.asset_id)) {
        map.set(row.asset_id, {
          memoryId: row.memory_id,
          title: row.title,
          year: Number(row.year),
          coverAssetId: row.cover_asset_id,
        });
      }
    }
    return map;
  }
}

/** The set of MM-DD strings within ±radius days of the given MM-DD (wraps). */
function windowDays(day: string, radius: number): string[] {
  const [mm, dd] = day.split('-').map(Number);
  const base = Date.UTC(2001, mm - 1, dd); // 2001: a non-leap reference year.
  const out: string[] = [];
  for (let offset = -radius; offset <= radius; offset++) {
    const d = new Date(base + offset * 24 * 60 * 60 * 1000);
    out.push(
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    );
  }
  return out;
}

function toItem(candidate: Candidate): { id: string; mediaType: MediaType } {
  return { id: candidate.id, mediaType: candidate.mediaType };
}

function mostCommonPlace(items: Candidate[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.place) {
      counts.set(item.place, (counts.get(item.place) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [place, count] of counts) {
    if (count > bestCount) {
      best = place;
      bestCount = count;
    }
  }
  return best;
}

function uniqueNames(
  items: Candidate[],
  people: Map<string, Array<{ personId: string; name: string }>>,
): string[] {
  const names = new Set<string>();
  for (const item of items) {
    for (const person of people.get(item.id) ?? []) {
      names.add(person.name);
    }
  }
  return [...names];
}

function withPeople(names: string[]): string {
  if (names.length === 1) return `with ${names[0]}`;
  if (names.length === 2) return `with ${names[0]} & ${names[1]}`;
  return `with ${names[0]}, ${names[1]} & ${names.length - 2} more`;
}

function scoreMoment(moment: OnThisDayMoment): number {
  const size = Math.min(moment.items.length, 20);
  if (moment.kind === 'memory') {
    return 1000 + size;
  }
  if (moment.kind === 'person') {
    return 500 + size;
  }
  const hasPlace = moment.title !== 'Around this day' ? 20 : 0;
  const hasPeople = moment.subtitle ? 20 : 0;
  return 100 + hasPlace + hasPeople + size;
}
