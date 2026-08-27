import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, eventCluster, eventClusterAsset, memory, memoryAsset } from '../database/schema';
import { GeocodeService } from './geocode.service';

/** A Memory suggestion card for the inbox. */
export interface InboxSuggestion {
  id: string;
  seedTitle: string;
  startAt: string;
  endAt: string;
  assetCount: number;
  /** Up to four asset ids for the cover mosaic. */
  previewAssetIds: string[];
  score: number;
}

/** Options for turning a suggestion into a Memory. */
export interface AcceptOptions {
  /** Overrides the auto-generated title. */
  title?: string;
  /**
   * The reviewer's edited photo selection. When given, the Memory is built from
   * exactly these assets instead of the suggestion's own members.
   */
  assetIds?: string[];
}

const PREVIEW_ASSET_COUNT = 4;

/**
 * The Memory Inbox: suggested clusters and the human decisions on them.
 * Accepting copies membership into a human-owned Memory (data-model.md §1.2).
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly geocode: GeocodeService,
  ) {}

  async listSuggestions(): Promise<InboxSuggestion[]> {
    // Lateral aggregate instead of a member query per cluster — an inbox of
    // hundreds of suggestions used to cost hundreds of round trips.
    const result = await this.db.execute<{
      id: string;
      seed_title: string;
      start_at: Date;
      end_at: Date;
      score: number;
      asset_count: number;
      preview_ids: string[] | null;
    }>(sql`
      select c.id, c.seed_title, c.start_at, c.end_at, c.score,
             coalesce(m.asset_count, 0)::int as asset_count,
             m.preview_ids
      from event_cluster c
      left join lateral (
        select count(*) as asset_count,
               (array_agg(eca.asset_id order by a.captured_at, a.id))[1:${PREVIEW_ASSET_COUNT}] as preview_ids
        from event_cluster_asset eca
        join asset a on a.id = eca.asset_id
        where eca.cluster_id = c.id
      ) m on true
      where c.status = 'suggested'
      order by c.start_at desc
    `);
    return result.rows.map((row) => ({
      id: row.id,
      seedTitle: row.seed_title,
      startAt: new Date(row.start_at).toISOString(),
      endAt: new Date(row.end_at).toISOString(),
      assetCount: row.asset_count,
      previewAssetIds: row.preview_ids ?? [],
      score: row.score,
    }));
  }

  /** Full member list of one suggestion, for the preview grid. */
  async getSuggestionAssets(clusterId: string): Promise<string[]> {
    await this.requireSuggested(clusterId);
    return this.loadMemberIdsOldestFirst(clusterId);
  }

  /** Accepts a suggestion into a Memory owned by the accepting user. */
  async accept(
    clusterId: string,
    userId: string,
    options: AcceptOptions = {},
  ): Promise<{ memoryId: string }> {
    const cluster = await this.requireSuggested(clusterId);
    const memberIds = await this.resolveMemberIds(clusterId, options.assetIds);
    // An edited selection can pull in photos outside the cluster's window, so
    // its date span is recomputed; an untouched accept keeps the cluster's own.
    const span = options.assetIds?.length
      ? await this.spanFor(memberIds, cluster)
      : { startAt: cluster.startAt, endAt: cluster.endAt };
    const memoryId = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(memory).values({
        id: memoryId,
        title: options.title?.trim() || cluster.seedTitle,
        startAt: span.startAt,
        endAt: span.endAt,
        coverAssetId: memberIds[0] ?? null,
        createdBy: userId,
      });
      if (memberIds.length > 0) {
        await tx.insert(memoryAsset).values(
          memberIds.map((assetId, index) => ({
            memoryId,
            assetId,
            sortOrder: index,
            addedBy: userId,
          })),
        );
      }
      await tx
        .update(eventCluster)
        .set({ status: 'accepted', acceptedMemoryId: memoryId, updatedAt: new Date() })
        .where(eq(eventCluster.id, clusterId));
    });
    // A date is a filename, not a memory: swap bare-date titles for the place.
    await this.labelWithPlace(memoryId, memberIds, cluster.seedTitle, span.startAt);
    return { memoryId };
  }

  /** Dismisses a suggestion; an identical re-detection will not resurface (S8.5). */
  async dismiss(clusterId: string): Promise<void> {
    await this.requireSuggested(clusterId);
    await this.db
      .update(eventCluster)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(eq(eventCluster.id, clusterId));
  }

  /** Dismisses every open suggestion at once; none of them resurface (S8.5). */
  async dismissAll(): Promise<{ dismissed: number }> {
    const rows = await this.db
      .update(eventCluster)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(eq(eventCluster.status, 'suggested'))
      .returning({ id: eventCluster.id });
    return { dismissed: rows.length };
  }

  /** Merges several suggestions into one Memory (S8.3). */
  async merge(
    clusterIds: string[],
    userId: string,
    title?: string,
  ): Promise<{ memoryId: string }> {
    const clusters = await this.db
      .select()
      .from(eventCluster)
      .where(inArray(eventCluster.id, clusterIds));
    if (clusters.length !== clusterIds.length || clusters.some((c) => c.status !== 'suggested')) {
      throw new NotFoundException('One of those suggestions is no longer available.');
    }
    const memberRows = await this.db
      .select({ assetId: eventClusterAsset.assetId, capturedAt: asset.capturedAt })
      .from(eventClusterAsset)
      .innerJoin(asset, eq(asset.id, eventClusterAsset.assetId))
      .where(inArray(eventClusterAsset.clusterId, clusterIds))
      .orderBy(asc(asset.capturedAt), asc(asset.id));
    const memberIds = [...new Set(memberRows.map((row) => row.assetId))];
    const startAt = new Date(Math.min(...clusters.map((c) => c.startAt.getTime())));
    const endAt = new Date(Math.max(...clusters.map((c) => c.endAt.getTime())));
    const memoryId = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(memory).values({
        id: memoryId,
        title: title?.trim() || clusters[0].seedTitle,
        startAt,
        endAt,
        coverAssetId: memberIds[0] ?? null,
        createdBy: userId,
      });
      await tx.insert(memoryAsset).values(
        memberIds.map((assetId, index) => ({ memoryId, assetId, sortOrder: index, addedBy: userId })),
      );
      await tx
        .update(eventCluster)
        .set({ status: 'accepted', acceptedMemoryId: memoryId, updatedAt: new Date() })
        .where(inArray(eventCluster.id, clusterIds));
    });
    await this.labelWithPlace(memoryId, memberIds, clusters[0].seedTitle, startAt);
    return { memoryId };
  }

  /**
   * Best-effort place labeling for a fresh Memory: reverse-geocodes the median
   * photo location, stores it, and upgrades a bare-date title to
   * "Bowdoin · March 23". Never fails the accept.
   */
  private async labelWithPlace(
    memoryId: string,
    memberIds: string[],
    seedTitle: string,
    startAt: Date,
  ): Promise<void> {
    try {
      if (memberIds.length === 0) {
        return;
      }
      const [gps] = await this.db
        .select({
          lat: sql<number | null>`percentile_cont(0.5) within group (order by ${asset.gpsLat})`,
          lon: sql<number | null>`percentile_cont(0.5) within group (order by ${asset.gpsLon})`,
        })
        .from(asset)
        .where(and(inArray(asset.id, memberIds), sql`${asset.gpsLat} is not null`));
      if (gps?.lat == null || gps?.lon == null) {
        return;
      }
      const fullLabel = await this.geocode.reverse(gps.lat, gps.lon);
      const label = fullLabel?.split(',')[0]?.trim();
      if (!label) {
        return;
      }
      const day = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(
        startAt,
      );
      await this.db
        .update(memory)
        .set({
          locationLabel: label,
          // Only bare-date titles are upgraded; a human-chosen title stands.
          title: sql`case when ${memory.title} = ${seedTitle} then ${`${label} · ${day}`} else ${memory.title} end`,
        })
        .where(eq(memory.id, memoryId));
    } catch {
      // Labeling is a garnish; the Memory is already saved.
    }
  }

  private async requireSuggested(clusterId: string): Promise<typeof eventCluster.$inferSelect> {
    const [cluster] = await this.db
      .select()
      .from(eventCluster)
      .where(eq(eventCluster.id, clusterId))
      .limit(1);
    if (!cluster || cluster.status !== 'suggested') {
      throw new NotFoundException('That suggestion is no longer available.');
    }
    return cluster;
  }

  /**
   * The final member set: the reviewer's explicit selection when given
   * (validated against real assets, order preserved), else the suggestion's own.
   */
  private async resolveMemberIds(clusterId: string, selection?: string[]): Promise<string[]> {
    if (!selection || selection.length === 0) {
      return this.loadMemberIdsOldestFirst(clusterId);
    }
    const rows = await this.db
      .select({ id: asset.id })
      .from(asset)
      .where(inArray(asset.id, selection));
    const known = new Set(rows.map((row) => row.id));
    const missing = selection.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new BadRequestException('Some selected photos are no longer available.');
    }
    return selection;
  }

  /**
   * Date span for the Memory header: min/max capture time across the chosen
   * assets, falling back to the cluster's own span when none carry a timestamp.
   */
  private async spanFor(
    memberIds: string[],
    cluster: typeof eventCluster.$inferSelect,
  ): Promise<{ startAt: Date; endAt: Date }> {
    if (memberIds.length === 0) {
      return { startAt: cluster.startAt, endAt: cluster.endAt };
    }
    const rows = await this.db
      .select({ capturedAt: asset.capturedAt })
      .from(asset)
      .where(inArray(asset.id, memberIds));
    const times = rows
      .map((row) => row.capturedAt?.getTime())
      .filter((time): time is number => typeof time === 'number');
    if (times.length === 0) {
      return { startAt: cluster.startAt, endAt: cluster.endAt };
    }
    return { startAt: new Date(Math.min(...times)), endAt: new Date(Math.max(...times)) };
  }

  private async loadMemberIdsOldestFirst(clusterId: string): Promise<string[]> {
    const rows = await this.db
      .select({ assetId: eventClusterAsset.assetId })
      .from(eventClusterAsset)
      .innerJoin(asset, eq(asset.id, eventClusterAsset.assetId))
      .where(eq(eventClusterAsset.clusterId, clusterId))
      .orderBy(asc(asset.capturedAt), asc(asset.id));
    return rows.map((row) => row.assetId);
  }
}
