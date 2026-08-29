import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { mkdir, readdir, rm, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { cleanupDismissal } from '../database/schema';
import { JobQueueService } from '../jobs/job-queue.service';
import { safeMoveFile } from '../trash/safe-file-move';

/** Background job type for in-place video conversion. */
export const CONVERT_VIDEO_JOB = 'convert_video';

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
}

/** One original slated for deletion after conversion (the undo window). */
export interface ConvertedOriginal {
  assetId: string;
  fileName: string;
  sizeBytes: number;
  deletesAt: string;
}

export interface CleanupSuggestions {
  junk: JunkSuggestion[];
  hogs: SpaceHogSuggestion[];
  /** Bytes reclaimable if every suggestion is accepted. */
  projectedSavingsBytes: number;
}

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
  ) {}

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
      converting: boolean;
    }>(sql`
      select a.id, f.file_name, f.size_bytes, a.media_type, a.duration_ms,
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
      };
    });
    const projectedSavingsBytes =
      junk.reduce((sum, item) => sum + item.sizeBytes, 0) +
      hogs.reduce(
        (sum, item) => sum + Math.max(0, item.sizeBytes - (item.estimatedBytes ?? item.sizeBytes)),
        0,
      );
    return { junk, hogs, projectedSavingsBytes };
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
  async queueConversion(assetId: string, codec: 'hevc' | 'h264'): Promise<void> {
    const [row] = await this.db.execute<{ id: string }>(
      sql`select id from asset where id = ${assetId} and media_type = 'video' and status = 'active'`,
    ).then((result) => result.rows.length ? [result.rows[0]] : []);
    if (!row) {
      throw new NotFoundException('That video does not exist.');
    }
    await this.queue.enqueue(
      CONVERT_VIDEO_JOB,
      { assetId, codec },
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
      if (!match) {
        continue;
      }
      try {
        const info = await stat(join(this.convertedOriginalsDir, name));
        originals.push({
          assetId: match[1],
          fileName: match[2],
          sizeBytes: info.size,
          deletesAt: new Date(info.mtimeMs + retentionMs).toISOString(),
        });
      } catch {
        // Racing the purge is fine.
      }
    }
    return originals.sort((a, b) => a.deletesAt.localeCompare(b.deletesAt));
  }

  /**
   * Undo a conversion: the parked original goes back where it was, the
   * converted file is deleted, and metadata re-extracts (codec included).
   */
  async restoreOriginal(assetId: string): Promise<void> {
    const originals = await this.listConvertedOriginals();
    const parked = originals.find((entry) => entry.assetId === assetId);
    if (!parked) {
      throw new NotFoundException('No parked original for that video.');
    }
    const result = await this.db.execute<{
      file_id: string;
      rel_path: string;
      root_path: string;
    }>(sql`
      select f.id as file_id, f.rel_path, r.path as root_path
      from asset_file f join library_root r on r.id = f.root_id
      where f.asset_id = ${assetId} and f.state = 'present'
      limit 1
    `);
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('That video has no present file.');
    }
    const parkedPath = join(this.convertedOriginalsDir, `${assetId}_${parked.fileName}`);
    const convertedPath = join(row.root_path, row.rel_path);
    // Original file name back in the original folder.
    const originalRelPath = row.rel_path.replace(/[^/\\]+$/, parked.fileName);
    const restoredPath = join(row.root_path, originalRelPath);
    // safeMoveFile (copy-then-delete fallback), NOT rename: the parked original
    // lives on the app-data volume while the library is a separate NAS mount, so
    // a plain rename across them throws EXDEV and the restore silently fails.
    const finalPath = await safeMoveFile(parkedPath, restoredPath);
    if (convertedPath !== finalPath) {
      await rm(convertedPath, { force: true }).catch(() => undefined);
    }
    const finalRelPath = finalPath
      .slice(row.root_path.length)
      .replace(/^[\\/]/, '')
      .replaceAll('\\', '/');
    await this.db.execute(sql`
      update asset_file
      set rel_path = ${finalRelPath},
          file_name = ${finalRelPath.split('/').pop() ?? parked.fileName},
          size_bytes = ${parked.sizeBytes},
          fs_mtime = now(), last_verified_at = now()
      where id = ${row.file_id}
    `);
    await this.db.execute(
      sql`delete from cleanup_dismissal where asset_id = ${assetId}`,
    );
    // Re-extract metadata (true codec, dimensions) and re-queue playback prep.
    await this.queue.enqueue(
      'reprocess_asset',
      { assetId },
      { dedupeKey: `reprocess_asset:${assetId}`, priority: 50 },
    );
  }

  /** Replaced originals past the trash retention window are gone for good. */
  private async purgeExpiredOriginals(): Promise<void> {
    const cutoff = Date.now() - this.config.trashRetentionDays * 24 * 60 * 60 * 1000;
    let names: string[];
    try {
      names = await readdir(this.convertedOriginalsDir);
    } catch {
      return; // Directory doesn't exist yet — nothing converted.
    }
    for (const name of names) {
      const path = join(this.convertedOriginalsDir, name);
      try {
        const info = await stat(path);
        if (info.mtimeMs < cutoff) {
          await rm(path, { force: true });
          this.logger.log(`Purged converted original past retention: ${name}`);
        }
      } catch {
        // Racing another purge is fine.
      }
    }
  }

  async ensureDirs(): Promise<void> {
    await mkdir(this.convertedOriginalsDir, { recursive: true });
  }
}
