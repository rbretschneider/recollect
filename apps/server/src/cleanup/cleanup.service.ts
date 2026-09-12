import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { join, resolve } from 'path';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { cleanupDismissal } from '../database/schema';
import { JobQueueService } from '../jobs/job-queue.service';
import { MlClientService } from '../ml/ml-client.service';
import { safeMoveFile } from '../trash/safe-file-move';
import { purgeVerdict } from './purge-verdict';
import { parseTapeLabel, TapeLabelGuess } from '../media/tape-label';
import { classifyMediaFile } from '../media/media-types';

/** Background job type for in-place video conversion. */
export const CONVERT_VIDEO_JOB = 'convert_video';

/** Background job type for undoing a conversion (a big cross-volume copy). */
export const RESTORE_ORIGINAL_JOB = 'restore_original';

/** sha256 of a file, streamed - the identity the scanner uses to match files to assets. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** A photo/video flagged as probably-junk. */
export interface JunkSuggestion {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  mediaType: string;
  reason: string;
}

/** A file eating outsized space, with the estimated post-conversion size. */
export interface SpaceHogSuggestion {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  mediaType: string;
  durationMs: number | null;
  /** Bits per second for videos; null for images. */
  bitrate: number | null;
  /** Estimated bytes after H.264 re-encode; null when conversion isn't offered. */
  estimatedBytes: number | null;
  converting: boolean;
  /** The date currently on record, and where it came from. */
  capturedAt: string;
  capturedAtSource: string;
  title: string | null;
  /** Title and date read off the cassette label, when the filename is a digitised tape. */
  labelGuess: TapeLabelGuess | null;
}

/** One original slated for deletion after conversion (the undo window). */
export interface ConvertedOriginal {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  deletesAt: string;
  /** A restore is queued/running for this original (a slow cross-volume copy). */
  restoring: boolean;
  /**
   * Set when the purge refuses to delete this original because the conversion
   * it replaced cannot be shown to be good: it stays, past its date, until a
   * person decides. Null means the replacement checks out.
   */
  held: string | null;
}

/**
 * Written beside a parked original before it is moved, so the undo depends on
 * nothing else surviving: not the asset's file row (a scan can re-point it),
 * not stored metadata (not every format carries a source path), not the asset
 * itself. Named `<assetId>.manifest.json` so the `<assetId>_<file>` listing
 * pattern never mistakes it for a video.
 */
export interface ConvertManifest {
  assetId: string;
  rootId: string;
  originalRelPath: string;
  originalSizeBytes: number;
  originalMtime: string;
  originalHash: string;
  /** What the asset recorded before conversion rewrote them; restore puts them back. */
  originalMime?: string;
  originalVideoCodec?: string | null;
  convertedRelPath: string;
  convertedSizeBytes: number;
  parkedAt: string;
}

export interface CleanupSuggestions {
  junk: JunkSuggestion[];
  hogs: SpaceHogSuggestion[];
  /**
   * Images CLIP thinks are probably accidental (floor / all-dark / heavy blur).
   * Suggestion-only and separated from hard "junk" because it's a fuzzy guess —
   * verify by tapping before removing. Empty when ML is off or unavailable.
   */
  accidental: JunkSuggestion[];
  /**
   * The redundant copies of near-duplicate photos (the best copy of each is
   * kept off the list). Exact byte-dupes are already merged by content hash;
   * these are re-encodes/re-exports — same shot, different bytes.
   */
  duplicates: JunkSuggestion[];
  /** Bytes reclaimable if every suggestion is accepted. */
  projectedSavingsBytes: number;
}

/** Cosine distance under which two images are treated as the same shot. */
const DUPLICATE_DISTANCE = 0.06;
/** Cap on how many duplicate copies to surface at once. */
const DUPLICATE_LIMIT = 200;

/**
 * Zero-shot "probably accidental" prompts. Each junk prompt only flags an image
 * when it's notably closer (smaller cosine distance) to that prompt than to the
 * good-photo reference — the relative margin is far more robust than any
 * absolute CLIP distance. Thresholds are deliberately conservative; tune
 * CLIP_ACCIDENTAL_* against the real library (false positives erode trust).
 */
const CLIP_GOOD_PROMPT = 'a clear normal photo of people, a place, or an object';
const CLIP_ACCIDENTAL_PROMPTS: ReadonlyArray<{ category: string; reason: string; prompt: string }> = [
  {
    category: 'floor',
    reason: 'Looks like an accidental shot of the floor or ground',
    prompt: 'a photo of an empty floor, carpet, pavement, or ground with nothing of interest',
  },
  {
    category: 'dark',
    reason: 'Looks like an accidental all-dark “pocket” shot',
    prompt: 'a completely black or near-black accidental photo taken by mistake',
  },
  {
    category: 'blur',
    reason: 'Looks heavily blurred / out of focus',
    prompt: 'an extremely blurry, badly out-of-focus, unusable smeared photo',
  },
];
/** Junk prompt must beat the good prompt by at least this cosine-distance margin. */
const CLIP_ACCIDENTAL_MARGIN = 0.05;
/** …and be within this absolute cosine distance of the junk prompt. */
const CLIP_ACCIDENTAL_MAX_DISTANCE = 0.85;
/** Cap so a bad threshold can't flood the advisor. */
const CLIP_ACCIDENTAL_LIMIT = 60;

/** Videos above this bitrate are worth re-encoding (old cameras, screen recs). */
const HOG_BITRATE_THRESHOLD = 12_000_000;
/** What a sane H.264 family video averages; drives the savings estimate. */
const TARGET_BITRATE = 4_500_000;
const TINY_IMAGE_BYTES = 32 * 1024;

/**
 * The cleanup advisor (storage on location): junk flags and space hogs,
 * review-inbox style — accept / dismiss, never auto-delete.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly queue: JobQueueService,
    private readonly ml: MlClientService,
  ) {}

  /** Cached prompt embeddings so we only hit the sidecar once per process. */
  private clipPrompts: { good: number[]; junk: Array<{ category: string; reason: string; vec: number[] }> } | null =
    null;

  /** Where replaced originals wait out the undo window after a conversion. */
  get convertedOriginalsDir(): string {
    return resolve(this.config.appDataDir, 'converted-originals');
  }

  async getSuggestions(): Promise<CleanupSuggestions> {
    await this.purgeExpiredOriginals();
    const junkResult = await this.db.execute<{
      id: string;
      file_name: string;
      size_bytes: number;
      media_type: string;
      reason: string;
    }>(sql`
      select a.id, f.file_name, f.size_bytes, a.media_type,
        case
          when f.size_bytes = 0 then 'Empty file — nothing to keep'
          when a.media_type = 'image' and f.size_bytes < ${TINY_IMAGE_BYTES}
            then 'Tiny stub — likely a cloud-only placeholder, not the real photo'
          else 'Damaged video — it cannot be played'
        end as reason
      from asset a
      join asset_file f on f.asset_id = a.id and f.state = 'present'
      left join cleanup_dismissal d on d.asset_id = a.id
      where a.status = 'active' and d.asset_id is null
        and (
          f.size_bytes = 0
          or (a.media_type = 'image' and f.size_bytes < ${TINY_IMAGE_BYTES})
          or (a.media_type = 'video' and a.stage_errors->>'playback' is not null)
        )
      order by f.size_bytes asc
      limit 100
    `);
    const hogResult = await this.db.execute<{
      id: string;
      file_name: string;
      size_bytes: number;
      media_type: string;
      duration_ms: number | null;
      captured_at: string;
      captured_at_source: string;
      title: string | null;
      converting: boolean;
    }>(sql`
      select a.id, f.file_name, f.size_bytes, a.media_type, a.duration_ms,
        a.captured_at, a.captured_at_source, a.title,
        exists(
          select 1 from job j
          where j.type = ${CONVERT_VIDEO_JOB}
            and j.status in ('queued', 'running')
            and j.payload->>'assetId' = a.id::text
        ) as converting
      from asset a
      join asset_file f on f.asset_id = a.id and f.state = 'present'
      left join cleanup_dismissal d on d.asset_id = a.id
      where a.status = 'active' and d.asset_id is null
        and a.media_type = 'video' and a.duration_ms > 0
        and (f.size_bytes::float * 8000 / a.duration_ms) > ${HOG_BITRATE_THRESHOLD}
      order by f.size_bytes desc
      limit 20
    `);
    const junk = junkResult.rows.map((row) => ({
      assetId: row.id,
      fileName: row.file_name,
      sizeBytes: Number(row.size_bytes),
      mediaType: row.media_type,
      reason: row.reason,
    }));
    const hogs = hogResult.rows.map((row) => {
      const sizeBytes = Number(row.size_bytes);
      const durationMs = row.duration_ms === null ? null : Number(row.duration_ms);
      const bitrate = durationMs ? Math.round((sizeBytes * 8000) / durationMs) : null;
      const estimatedBytes = durationMs
        ? Math.round((TARGET_BITRATE / 8000) * durationMs)
        : null;
      return {
        assetId: row.id,
        fileName: row.file_name,
        sizeBytes,
        mediaType: row.media_type,
        durationMs,
        bitrate,
        estimatedBytes,
        converting: row.converting,
        capturedAt: new Date(row.captured_at).toISOString(),
        capturedAtSource: row.captured_at_source,
        title: row.title,
        // What the cassette label says, for the convert sheet to prefill and a
        // person to confirm. Null for anything that isn't a digitised tape.
        labelGuess: parseTapeLabel(row.file_name),
      };
    });
    // Fuzzy CLIP guesses are fully isolated: any failure yields an empty list
    // and never disturbs the deterministic junk/hog advice above.
    const accidental = await this.clipFlagged().catch((error) => {
      this.logger.warn(`CLIP accidental-photo pass skipped: ${(error as Error).message}`);
      return [] as JunkSuggestion[];
    });
    const duplicates = await this.findDuplicates().catch((error) => {
      this.logger.warn(`Duplicate pass skipped: ${(error as Error).message}`);
      return [] as JunkSuggestion[];
    });
    const projectedSavingsBytes =
      junk.reduce((sum, item) => sum + item.sizeBytes, 0) +
      hogs.reduce(
        (sum, item) => sum + Math.max(0, item.sizeBytes - (item.estimatedBytes ?? item.sizeBytes)),
        0,
      );
    const withDupes = projectedSavingsBytes + duplicates.reduce((sum, item) => sum + item.sizeBytes, 0);
    return { junk, hogs, accidental, duplicates, projectedSavingsBytes: withDupes };
  }

  /**
   * Redundant copies of near-duplicate shots. The new-upload-app scenario:
   * a re-exported JPEG keeps the same EXIF but has different bytes, so the
   * content-hash dedup can't merge it. We group active assets that share an
   * exact EXIF capture time + dimensions, confirm images are visually the same
   * with CLIP (so a burst isn't mistaken for a dupe), keep the largest copy of
   * each group, and flag the rest.
   */
  private async findDuplicates(): Promise<JunkSuggestion[]> {
    const result = await this.db.execute<{
      id: string;
      file_name: string;
      size_bytes: number;
      media_type: string;
      captured_at: string;
      width: number;
      height: number;
      duration_ms: number | null;
    }>(sql`
      select a.id, f.file_name, f.size_bytes, a.media_type,
             a.captured_at::text as captured_at, a.width, a.height, a.duration_ms
      from asset a
      join asset_file f on f.asset_id = a.id and f.state = 'present'
      left join cleanup_dismissal d on d.asset_id = a.id
      where a.status = 'active' and d.asset_id is null
        and a.captured_at_source = 'exif' and a.width is not null
        and a.captured_at in (
          select captured_at from asset
          where status = 'active' and captured_at_source = 'exif'
          group by captured_at having count(*) > 1
        )
      order by a.captured_at
      limit 4000
    `);
    // Group by exact capture time + dimensions + type.
    const groups = new Map<string, typeof result.rows>();
    for (const row of result.rows) {
      const key = `${row.captured_at}|${row.width}|${row.height}|${row.media_type}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const imageIds = result.rows.filter((row) => row.media_type === 'image').map((row) => row.id);
    const embeddings = await this.loadEmbeddings(imageIds);
    const flagged: JunkSuggestion[] = [];
    for (const members of groups.values()) {
      if (members.length < 2) {
        continue;
      }
      // Keep the biggest file (usually the best quality); flag the rest.
      const ordered = [...members].sort((a, b) => Number(b.size_bytes) - Number(a.size_bytes));
      const keeper = ordered[0];
      for (const other of ordered.slice(1)) {
        if (other.media_type === 'image') {
          const a = embeddings.get(keeper.id);
          const b = embeddings.get(other.id);
          // No CLIP → don't risk calling a burst frame a duplicate.
          if (!a || !b || cosineDistance(a, b) > DUPLICATE_DISTANCE) {
            continue;
          }
        } else if (other.duration_ms !== keeper.duration_ms) {
          continue; // Videos: same length too, or it's not the same clip.
        }
        flagged.push({
          assetId: other.id,
          fileName: other.file_name,
          sizeBytes: Number(other.size_bytes),
          mediaType: other.media_type,
          reason: 'Duplicate — same shot as another copy you already have',
        });
        if (flagged.length >= DUPLICATE_LIMIT) {
          return flagged;
        }
      }
    }
    return flagged;
  }

  /** Loads CLIP vectors for the given assets as plain number arrays. */
  private async loadEmbeddings(ids: string[]): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    if (ids.length === 0) {
      return map;
    }
    const result = await this.db.execute<{ asset_id: string; vec: string }>(sql`
      select asset_id, embedding::text as vec
      from asset_embedding
      where asset_id = any(string_to_array(${ids.join(',')}, ',')::uuid[])
    `);
    for (const row of result.rows) {
      try {
        map.set(row.asset_id, JSON.parse(row.vec) as number[]);
      } catch {
        // Skip an unparseable vector.
      }
    }
    return map;
  }

  /** Embed the prompt set once, caching the vectors for the process lifetime. */
  private async ensureClipPrompts(): Promise<boolean> {
    if (this.clipPrompts) {
      return this.clipPrompts.good.length > 0;
    }
    const good = (await this.ml.embedText(CLIP_GOOD_PROMPT)).embedding;
    const junk: Array<{ category: string; reason: string; vec: number[] }> = [];
    for (const entry of CLIP_ACCIDENTAL_PROMPTS) {
      const vec = (await this.ml.embedText(entry.prompt)).embedding;
      if (vec.length > 0) {
        junk.push({ category: entry.category, reason: entry.reason, vec });
      }
    }
    this.clipPrompts = { good, junk };
    return good.length > 0 && junk.length > 0;
  }

  /**
   * Images CLIP judges probably-accidental. For each junk prompt, an image is
   * flagged only when it sits meaningfully closer to that prompt than to the
   * good-photo reference. First matching category wins; capped and dismissible.
   */
  private async clipFlagged(): Promise<JunkSuggestion[]> {
    if (!this.ml.isEnabled) {
      return [];
    }
    if (!(await this.ensureClipPrompts()) || !this.clipPrompts) {
      return [];
    }
    const goodLiteral = JSON.stringify(this.clipPrompts.good);
    const seen = new Set<string>();
    const flagged: JunkSuggestion[] = [];
    for (const junk of this.clipPrompts.junk) {
      const junkLiteral = JSON.stringify(junk.vec);
      const result = await this.db.execute<{
        id: string;
        file_name: string;
        size_bytes: number;
        media_type: string;
      }>(sql`
        select a.id, f.file_name, f.size_bytes, a.media_type
        from asset_embedding e
        join asset a on a.id = e.asset_id and a.status = 'active' and a.media_type = 'image'
        join asset_file f on f.asset_id = a.id and f.state = 'present'
        left join cleanup_dismissal d on d.asset_id = a.id
        where d.asset_id is null
          and (e.embedding <=> ${junkLiteral}::vector) < ${CLIP_ACCIDENTAL_MAX_DISTANCE}
          and (e.embedding <=> ${junkLiteral}::vector)
              < (e.embedding <=> ${goodLiteral}::vector) - ${CLIP_ACCIDENTAL_MARGIN}
        order by (e.embedding <=> ${junkLiteral}::vector)
        limit ${CLIP_ACCIDENTAL_LIMIT}
      `);
      for (const row of result.rows) {
        if (seen.has(row.id)) {
          continue;
        }
        seen.add(row.id);
        flagged.push({
          assetId: row.id,
          fileName: row.file_name,
          sizeBytes: Number(row.size_bytes),
          mediaType: row.media_type,
          reason: junk.reason,
        });
      }
    }
    return flagged.slice(0, CLIP_ACCIDENTAL_LIMIT);
  }

  /** "Leave these alone" — the suggestion never returns. */
  async dismiss(assetIds: string[], userId: string): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    await this.db
      .insert(cleanupDismissal)
      .values(assetIds.map((assetId) => ({ assetId, dismissedBy: userId })))
      .onConflictDoNothing();
  }

  /** Queues the in-place re-encode for one video (HEVC default, H.264 option). */
  async queueConversion(
    assetId: string,
    codec: 'hevc' | 'h264',
    confirmed: { title?: string; capturedAt?: string; tzOffsetMin?: number } = {},
  ): Promise<void> {
    const [row] = await this.db.execute<{ id: string }>(
      sql`select id from asset where id = ${assetId} and media_type = 'video' and status = 'active'`,
    ).then((result) => result.rows.length ? [result.rows[0]] : []);
    if (!row) {
      throw new NotFoundException('That video does not exist.');
    }
    await this.queue.enqueue(
      CONVERT_VIDEO_JOB,
      { assetId, codec, ...confirmed },
      { dedupeKey: `${CONVERT_VIDEO_JOB}:${assetId}`, priority: 200 },
    );
  }

  /** Originals slated for deletion after conversion, restorable until purge. */
  async listConvertedOriginals(): Promise<ConvertedOriginal[]> {
    let names: string[];
    try {
      names = await readdir(this.convertedOriginalsDir);
    } catch {
      return [];
    }
    const retentionMs = this.config.trashRetentionDays * 24 * 60 * 60 * 1000;
    const originals: ConvertedOriginal[] = [];
    for (const name of names) {
      const match = /^([0-9a-f-]{36})_(.+)$/.exec(name);
      if (!match || name.endsWith('.manifest.json')) {
        continue;
      }
      try {
        const info = await stat(join(this.convertedOriginalsDir, name));
        originals.push({
          assetId: match[1],
          fileName: match[2],
          sizeBytes: info.size,
          deletesAt: new Date(info.mtimeMs + retentionMs).toISOString(),
          restoring: false,
          held: await this.purgeBlocker(match[1]),
        });
      } catch {
        // Racing the purge is fine.
      }
    }
    if (originals.length > 0) {
      const jobs = await this.db.execute<{ asset_id: string }>(sql`
        select payload->>'assetId' as asset_id from job
        where type = ${RESTORE_ORIGINAL_JOB} and status in ('queued', 'running')
      `);
      const restoringIds = new Set(jobs.rows.map((row) => row.asset_id));
      for (const original of originals) {
        original.restoring = restoringIds.has(original.assetId);
      }
    }
    return originals.sort((a, b) => a.deletesAt.localeCompare(b.deletesAt));
  }

  /**
   * Queue the restore as a background job. The undo is a full copy of the
   * parked original back onto the NAS (tens of GB, across volumes) — far too
   * slow to run inside the HTTP request without tripping gateway timeouts and
   * flashing a false "failed". The advisor shows a live "Restoring…" state off
   * the job's status instead.
   */
  async queueRestore(assetId: string): Promise<void> {
    const originals = await this.listConvertedOriginals();
    if (!originals.some((entry) => entry.assetId === assetId)) {
      throw new NotFoundException('No parked original for that video.');
    }
    await this.queue.enqueue(
      RESTORE_ORIGINAL_JOB,
      { assetId },
      { dedupeKey: `${RESTORE_ORIGINAL_JOB}:${assetId}`, priority: 200 },
    );
  }

  /**
   * Undo a conversion (runs in the background job): the parked original goes
   * back where it was, the converted file is deleted, and metadata re-extracts
   * (codec included). Resilient to a missing asset_file row — a scan may have
   * dropped the row when the (corrupt) converted file failed verification, in
   * which case the original location is recovered from asset_metadata.
   */
  async performRestore(assetId: string): Promise<void> {
    const originals = await this.listConvertedOriginals();
    const parked = originals.find((entry) => entry.assetId === assetId);
    if (!parked) {
      return; // Already restored or purged — nothing parked to put back.
    }
    const target = await this.resolveRestoreTarget(assetId, parked.fileName);
    const parkedPath = join(this.convertedOriginalsDir, `${assetId}_${parked.fileName}`);
    const restoredPath = join(target.rootPath, target.originalRelPath);
    // safeMoveFile (copy-then-delete fallback), NOT rename: the parked original
    // lives on the app-data volume while the library is a separate NAS mount, so
    // a plain rename across them throws EXDEV and the restore silently fails.
    const finalPath = await safeMoveFile(parkedPath, restoredPath);
    // The original is back. Prove it before anything else is touched: the
    // manifest knows exactly what was parked, so a short or altered copy is
    // caught here rather than discovered after the converted file is gone.
    const manifest = await this.readManifest(assetId);
    const landed = await stat(finalPath);
    if (manifest && landed.size !== manifest.originalSizeBytes) {
      throw new Error(
        `Restore ${assetId}: restored file is ${landed.size} bytes, expected ${manifest.originalSizeBytes}; converted file left in place.`,
      );
    }
    // Drop the leftover converted file (the smaller re-encode that took the
    // original's place), unless the restore happened to land on that same path.
    if (target.convertedPath && target.convertedPath !== finalPath) {
      await rm(target.convertedPath, { force: true }).catch(() => undefined);
      // If a scan had re-indexed the converted file as its own asset, that
      // asset just lost its only file. Say so rather than leave a row that
      // claims a file which is no longer there.
      const convertedRelPath = target.convertedPath
        .slice(target.rootPath.length)
        .replace(/^[\\/]/, '')
        .replaceAll('\\', '/');
      const orphaned = await this.db.execute<{ asset_id: string }>(sql`
        update asset_file set state = 'missing'
        where root_id = ${target.rootId} and rel_path = ${convertedRelPath} and asset_id <> ${assetId}
        returning asset_id
      `);
      for (const { asset_id } of orphaned.rows) {
        await this.db.execute(sql`
          update asset set status = 'missing', updated_at = now()
          where id = ${asset_id} and status = 'active'
            and not exists (select 1 from asset_file where asset_id = ${asset_id} and state = 'present')
        `);
      }
    }
    const finalRelPath = finalPath
      .slice(target.rootPath.length)
      .replace(/^[\\/]/, '')
      .replaceAll('\\', '/');
    const fileName = finalRelPath.split('/').pop() ?? parked.fileName;
    // Tell the library what this file IS again - real mtime and real hash -
    // or the next scan re-ingests the restored original as a brand-new asset
    // and orphans this one, exactly the failure the undo exists to repair.
    const contentHash = manifest?.originalHash ?? (await hashFile(finalPath));
    if (target.fileId) {
      await this.db.execute(sql`
        update asset_file
        set rel_path = ${finalRelPath}, file_name = ${fileName},
            size_bytes = ${landed.size}, state = 'present',
            fs_mtime = ${landed.mtime}, last_verified_at = now()
        where id = ${target.fileId}
      `);
    } else {
      // The row was dropped when the corrupt converted file failed a scan.
      // Rebuild it so the asset points at the restored original again.
      await this.db.execute(sql`
        insert into asset_file
          (id, asset_id, root_id, rel_path, file_name, size_bytes, fs_mtime, state, last_verified_at)
        values
          (${randomUUID()}, ${assetId}, ${target.rootId}, ${finalRelPath}, ${fileName},
           ${landed.size}, ${landed.mtime}, 'present', now())
        on conflict (root_id, rel_path) do update
          set asset_id = excluded.asset_id, file_name = excluded.file_name,
              size_bytes = excluded.size_bytes, state = 'present',
              fs_mtime = excluded.fs_mtime, last_verified_at = now()
      `);
    }
    // The asset may have been flagged 'missing' when its file vanished — bring
    // it back (never resurrect something the user has since trashed), with the
    // original's identity and without the damaged-conversion flag.
    // Convert rewrote mime and codec for the mp4; the file is the original
    // again, so they go back too. Manifests written before these fields
    // existed fall back to what the filename says the file is.
    const restoredMime = manifest?.originalMime ?? classifyMediaFile(fileName)?.mime ?? null;
    await this.db.execute(sql`
      update asset
      set status = 'active',
          mime = coalesce(${restoredMime}, mime),
          video_codec = ${manifest?.originalVideoCodec ?? null},
          stage_errors = case when stage_errors is null then null
                              else (stage_errors::jsonb - 'playback')::jsonb end,
          updated_at = now()
      where id = ${assetId} and status <> 'trashed'
    `);
    // The playback rendition in app-data was made from the converted file,
    // which is gone. Left in place, the re-queued transcode sees "already
    // done" and the original plays through a rendition of something else.
    // Derived cache only - regenerated from the restored file by the job below.
    await rm(resolve(this.config.appDataDir, 'playback', assetId.slice(0, 2), `${assetId}.mp4`), {
      force: true,
    }).catch(() => undefined);
    // content_hash is unique. If a duplicate of this original was indexed
    // elsewhere, that asset already owns the hash; the file is still restored
    // and the next scan will simply link it there. Log it rather than fail.
    const claimed = await this.db.execute<{ id: string }>(sql`
      update asset set content_hash = ${contentHash}
      where id = ${assetId}
        and not exists (select 1 from asset where content_hash = ${contentHash} and id <> ${assetId})
      returning id
    `);
    if (claimed.rows.length === 0) {
      this.logger.warn(
        `Restore ${assetId}: another asset already carries this file's hash (a duplicate); left its hash unchanged.`,
      );
    }
    await this.removeManifest(assetId);
    // The user just chose the original over the converted copy — retire the
    // suggestion so the advisor doesn't immediately nag to redo the very
    // conversion they undid. (They can always re-suggest by not dismissing.)
    await this.db.execute(sql`
      insert into cleanup_dismissal (asset_id, dismissed_by)
      values (${assetId}, null)
      on conflict (asset_id) do nothing
    `);
    // Re-extract metadata (true codec, dimensions) and re-queue playback prep.
    await this.queue.enqueue(
      'reprocess_asset',
      { assetId },
      { dedupeKey: `reprocess_asset:${assetId}`, priority: 50 },
    );
  }

  /**
   * Where a parked original should be restored to. Prefers the live asset_file
   * row; falls back to the original path recorded in asset_metadata (exiftool's
   * SourceFile) when the row was dropped, so a corrupt-conversion casualty is
   * still recoverable.
   */
  private async resolveRestoreTarget(
    assetId: string,
    parkedFileName: string,
  ): Promise<{
    rootId: string;
    rootPath: string;
    originalRelPath: string;
    convertedPath: string | null;
    fileId: string | null;
  }> {
    // The manifest is the authority: it was written by the conversion itself,
    // before anything moved, and nothing that happens to the database later
    // can change what it says.
    const manifest = await this.readManifest(assetId);
    if (manifest) {
      const [root] = (
        await this.db.execute<{ path: string }>(sql`select path from library_root where id = ${manifest.rootId}`)
      ).rows;
      if (!root) {
        throw new NotFoundException('The library root this original came from no longer exists.');
      }
      const existing = await this.db.execute<{ file_id: string }>(sql`
        select id as file_id from asset_file
        where asset_id = ${assetId} and root_id = ${manifest.rootId} and state = 'present' limit 1
      `);
      return {
        rootId: manifest.rootId,
        rootPath: root.path,
        originalRelPath: manifest.originalRelPath,
        convertedPath: join(root.path, manifest.convertedRelPath),
        fileId: existing.rows[0]?.file_id ?? null,
      };
    }
    const present = await this.db.execute<{
      file_id: string;
      rel_path: string;
      root_id: string;
      root_path: string;
    }>(sql`
      select f.id as file_id, f.rel_path, f.root_id, r.path as root_path
      from asset_file f join library_root r on r.id = f.root_id
      where f.asset_id = ${assetId} and f.state = 'present'
      limit 1
    `);
    const row = present.rows[0];
    if (row) {
      return {
        rootId: row.root_id,
        rootPath: row.root_path,
        originalRelPath: row.rel_path.replace(/[^/\\]+$/, parkedFileName),
        convertedPath: join(row.root_path, row.rel_path),
        fileId: row.file_id,
      };
    }
    // No live file row — recover the original absolute path from stored metadata.
    const meta = await this.db.execute<{ source: string | null }>(sql`
      select raw->>'SourceFile' as source from asset_metadata where asset_id = ${assetId} limit 1
    `);
    const source = meta.rows[0]?.source;
    if (!source) {
      throw new NotFoundException('Cannot determine where to restore this original.');
    }
    const roots = await this.db.execute<{ id: string; path: string }>(
      sql`select id, path from library_root`,
    );
    const normSource = source.replaceAll('\\', '/');
    // Longest matching root path wins (nested roots).
    const match = roots.rows
      .map((r) => ({ id: r.id, path: r.path, norm: r.path.replaceAll('\\', '/').replace(/\/+$/, '') }))
      .filter((r) => normSource === r.norm || normSource.startsWith(`${r.norm}/`))
      .sort((a, b) => b.norm.length - a.norm.length)[0];
    if (!match) {
      throw new NotFoundException('The original file is outside every library root.');
    }
    const relFromMeta = normSource.slice(match.norm.length).replace(/^\/+/, '');
    const dir = relFromMeta.includes('/')
      ? relFromMeta.slice(0, relFromMeta.lastIndexOf('/') + 1)
      : '';
    return {
      rootId: match.id,
      rootPath: match.path,
      originalRelPath: dir + parkedFileName,
      // The converted leftover sits at the original path with an .mp4 extension.
      convertedPath: join(match.path, relFromMeta.replace(/\.[^./]+$/, '.mp4')),
      fileId: null,
    };
  }

  /**
   * Replaced originals past the trash retention window are gone for good -
   * but only once the thing that replaced them is proven to be a working
   * video. Age alone used to be the whole test. On 2026-09-11 it deleted the
   * only copy of a 14 GB family tape whose conversion had produced a truncated
   * file, and whose restore had already failed; nothing checked either fact.
   * Now every condition that would make a restore necessary makes the purge
   * refuse, and the refusal is visible in the advisor as a held original.
   */
  private async purgeExpiredOriginals(): Promise<void> {
    const cutoff = Date.now() - this.config.trashRetentionDays * 24 * 60 * 60 * 1000;
    let names: string[];
    try {
      names = await readdir(this.convertedOriginalsDir);
    } catch {
      return; // Directory doesn't exist yet — nothing converted.
    }
    for (const name of names) {
      const match = /^([0-9a-f-]{36})_(.+)$/.exec(name);
      if (!match || name.endsWith('.manifest.json')) {
        continue;
      }
      const path = join(this.convertedOriginalsDir, name);
      try {
        const info = await stat(path);
        if (info.mtimeMs >= cutoff) {
          continue;
        }
        const blocker = await this.purgeBlocker(match[1]);
        if (blocker) {
          this.logger.warn(`Kept converted original ${name} past retention: ${blocker}`);
          continue;
        }
        await rm(path, { force: true });
        await this.removeManifest(match[1]);
        this.logger.log(`Purged converted original past retention: ${name}`);
      } catch {
        // Racing another purge is fine.
      }
    }
  }

  /**
   * Why a parked original must NOT be deleted yet, or null if its replacement
   * checks out on every count a restore would need. Read the manifest, then
   * the library: the converted file must exist at the size the conversion
   * produced, belong to the same asset, and that asset must be active and not
   * flagged unplayable. Anything unknown is a reason to keep, never to delete.
   */
  async purgeBlocker(assetId: string): Promise<string | null> {
    const manifest = await this.readManifest(assetId);
    if (!manifest) {
      // Parked before manifests existed. The only evidence is the library.
      const legacy = await this.db.execute<{ status: string; rel_path: string | null; playback_error: string | null }>(sql`
        select a.status, f.rel_path, a.stage_errors->>'playback' as playback_error
        from asset a left join asset_file f on f.asset_id = a.id and f.state = 'present'
        where a.id = ${assetId} limit 1
      `);
      const row = legacy.rows[0];
      if (!row) return 'its asset no longer exists';
      if (row.status !== 'active') return `its asset is ${row.status}`;
      if (!row.rel_path) return 'its asset has no file on disk';
      if (row.playback_error) return 'the converted video is flagged as damaged';
      if (!/\.mp4$/i.test(row.rel_path)) return 'its asset no longer points at a converted file';
      return null;
    }
    // Gather the evidence; the decision itself is a pure function with a test
    // that walks every reason to refuse.
    const [root] = (
      await this.db.execute<{ path: string }>(sql`select path from library_root where id = ${manifest.rootId}`)
    ).rows;
    const landed = root ? await stat(join(root.path, manifest.convertedRelPath)).catch(() => null) : null;
    const owner = await this.db.execute<{ asset_id: string; status: string; playback_error: string | null; size_bytes: number }>(sql`
      select f.asset_id, a.status, a.stage_errors->>'playback' as playback_error, f.size_bytes
      from asset_file f join asset a on a.id = f.asset_id
      where f.root_id = ${manifest.rootId} and f.rel_path = ${manifest.convertedRelPath} and f.state = 'present'
      limit 1
    `);
    const failed = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n from job
      where type = ${RESTORE_ORIGINAL_JOB} and status = 'failed'
        and payload->>'assetId' = ${assetId}
        and coalesce(finished_at, created_at) > now() - interval '30 days'
    `);
    const row = owner.rows[0];
    return purgeVerdict({
      manifest,
      rootExists: root !== undefined,
      convertedSizeOnDisk: landed?.size ?? null,
      owner: row ? { assetId: row.asset_id, status: row.status, playbackError: row.playback_error, indexedSizeBytes: Number(row.size_bytes) } : null,
      recentFailedRestores: failed.rows[0]?.n ?? 0,
    });
  }

  manifestPath(assetId: string): string {
    return join(this.convertedOriginalsDir, `${assetId}.manifest.json`);
  }

  async writeManifest(manifest: ConvertManifest): Promise<void> {
    await this.ensureDirs();
    await writeFile(this.manifestPath(manifest.assetId), JSON.stringify(manifest, null, 2));
  }

  async readManifest(assetId: string): Promise<ConvertManifest | null> {
    try {
      return JSON.parse(await readFile(this.manifestPath(assetId), 'utf8')) as ConvertManifest;
    } catch {
      return null;
    }
  }

  async removeManifest(assetId: string): Promise<void> {
    await rm(this.manifestPath(assetId), { force: true }).catch(() => undefined);
  }

  async ensureDirs(): Promise<void> {
    await mkdir(this.convertedOriginalsDir, { recursive: true });
  }
}

/** Cosine distance (1 - cosine similarity) between two equal-length vectors. */
function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 1;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) {
    return 1;
  }
  return 1 - dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
