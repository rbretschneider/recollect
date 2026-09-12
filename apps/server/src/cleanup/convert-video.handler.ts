import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { and, eq } from 'drizzle-orm';
import ffmpegPath from 'ffmpeg-static';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { copyFile, mkdir, rename, rm, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, cleanupDismissal, libraryRoot } from '../database/schema';
import { JobHandler, JobHandlerRegistry } from '../jobs/job-handler';
import { JobQueueService } from '../jobs/job-queue.service';
import { AssetsService } from '../assets/assets.service';
import { probeDurationSeconds } from '../media/probe-duration';
import { CleanupService, CONVERT_VIDEO_JOB } from './cleanup.service';

const execFileAsync = promisify(execFile);

/** sha256 of a file, streamed - the same identity the scanner computes. */
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
const FFMPEG_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * In-place video conversion for the cleanup advisor: re-encodes a bloated
 * video to efficient H.264 and REPLACES the original on the NAS. The
 * original moves to converted-originals/ for the trash-retention window —
 * that's the undo. Aborts (keeping the original untouched) unless the new
 * file is meaningfully smaller.
 */
@Injectable()
export class ConvertVideoHandler implements JobHandler, OnModuleInit {
  readonly type = CONVERT_VIDEO_JOB;
  private readonly logger = new Logger(ConvertVideoHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly cleanup: CleanupService,
    private readonly queue: JobQueueService,
    private readonly assets: AssetsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId, codec = 'hevc', title, capturedAt, tzOffsetMin } = payload as {
      assetId: string;
      codec?: 'hevc' | 'h264';
      title?: string;
      capturedAt?: string;
      tzOffsetMin?: number;
    };
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary is not available on this platform.');
    }
    const [row] = await this.db
      .select({
        fileId: assetFile.id,
        relPath: assetFile.relPath,
        rootId: assetFile.rootId,
        rootPath: libraryRoot.path,
        sizeBytes: assetFile.sizeBytes,
        mime: asset.mime,
        videoCodec: asset.videoCodec,
      })
      .from(assetFile)
      .innerJoin(asset, eq(asset.id, assetFile.assetId))
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(and(eq(assetFile.assetId, assetId), eq(assetFile.state, 'present')))
      .limit(1);
    if (!row) {
      this.logger.warn(`Convert ${assetId}: no present file; skipping.`);
      return;
    }
    // What the person confirmed in the convert sheet. The title is true whatever
    // happens next, so it lands now. The date waits for the end of whichever
    // path this takes: setCapturedAt queues a file rewrite, and that must never
    // run against the source while ffmpeg is still reading it.
    if (title !== undefined) {
      await this.db
        .update(asset)
        .set({ title: title.trim() || null, updatedAt: new Date() })
        .where(eq(asset.id, assetId));
    }
    const applyConfirmedDate = async (): Promise<void> => {
      if (capturedAt) {
        await this.assets.setCapturedAt(assetId, new Date(capturedAt), tzOffsetMin ?? 0);
      }
    };
    const sourcePath = join(row.rootPath, row.relPath);
    // Per-attempt temp name: two attempts of one job once ran at the same time
    // (lease expired mid-encode) and wrote the same file with -y. The lease
    // now heartbeats, but a shared output path is never worth the risk.
    const temp = resolve(
      this.config.appDataDir,
      'staging',
      `convert_${assetId}_${randomUUID().slice(0, 8)}.mp4`,
    );
    await mkdir(dirname(temp), { recursive: true });
    this.logger.log(`Converting ${sourcePath}…`);
    // HEVC (~40% smaller, the archive choice; playback renditions cover old
    // browsers) or H.264 (plays natively everywhere, incl. old set-top boxes).
    const videoArgs =
      codec === 'hevc'
        ? ['-c:v', 'libx265', '-preset', 'medium', '-crf', '26', '-tag:v', 'hvc1']
        : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23'];
    try {
      await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-loglevel', 'error',
          '-threads', String(this.config.transcodeThreads),
          '-i', sourcePath,
          '-map_metadata', '0',
          ...videoArgs,
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '160k',
          '-movflags', '+faststart',
          temp,
        ],
        { maxBuffer: FFMPEG_MAX_BUFFER_BYTES },
      );
    } catch (error) {
      // A failed encode leaves a partial file in staging; don't let it pile up.
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
    const converted = await stat(temp);
    // Validity gate BEFORE anything is swapped: the encode must be a COMPLETE,
    // readable video — not just a smaller file. A failed/interrupted ffmpeg run
    // (a DV source with bitstream errors, a full disk, an OOM kill) leaves a
    // truncated file with no moov atom that is tiny; the "smaller = success"
    // heuristic below would otherwise treat that as great compression and
    // replace a good original with garbage. Compare durations: the output must
    // run at least 90% as long as the source, or we abort and keep the original.
    const [sourceSeconds, outputSeconds] = await Promise.all([
      probeDurationSeconds(sourcePath),
      probeDurationSeconds(temp),
    ]);
    const outputIsComplete =
      outputSeconds !== null &&
      outputSeconds > 0 &&
      (sourceSeconds === null || outputSeconds >= sourceSeconds * 0.9);
    if (!outputIsComplete) {
      await rm(temp, { force: true });
      await applyConfirmedDate();
      throw new Error(
        `Convert ${assetId}: re-encode failed validation ` +
          `(source ${sourceSeconds ?? '?'}s → output ${outputSeconds ?? 'unreadable'}); ` +
          `kept the original untouched.`,
      );
    }
    // Not meaningfully smaller → the original wins; nothing is touched.
    if (converted.size >= row.sizeBytes * 0.85) {
      await rm(temp, { force: true });
      await this.db
        .insert(cleanupDismissal)
        .values({ assetId, dismissedBy: null })
        .onConflictDoNothing();
      this.logger.log(
        `Convert ${assetId}: re-encode saved too little (${converted.size} vs ${row.sizeBytes}); kept the original.`,
      );
      await applyConfirmedDate();
      return;
    }
    // Undo window: the original parks in converted-originals for the trash
    // retention period before the purge sweep removes it.
    await this.cleanup.ensureDirs();
    const newRelPath = row.relPath.replace(/\.[^./\\]+$/, '.mp4');
    const newPath = join(row.rootPath, newRelPath);
    const parked = join(
      this.cleanup.convertedOriginalsDir,
      `${assetId}_${basename(row.relPath)}`,
    );
    // The manifest is written BEFORE the original moves and records everything
    // a restore needs, so the undo depends on nothing in the database staying
    // the way it was. It used to: restore looked the asset up by its file row,
    // a later scan had re-pointed that row at a brand-new asset, and the undo
    // 404'd while the purge went ahead and deleted the only copy.
    const [originalHash, originalStat] = await Promise.all([hashFile(sourcePath), stat(sourcePath)]);
    await this.cleanup.writeManifest({
      assetId,
      rootId: row.rootId,
      originalRelPath: row.relPath,
      originalSizeBytes: originalStat.size,
      originalMtime: originalStat.mtime.toISOString(),
      originalHash,
      originalMime: row.mime,
      originalVideoCodec: row.videoCodec,
      convertedRelPath: newRelPath,
      convertedSizeBytes: converted.size,
      parkedAt: new Date().toISOString(),
    });
    await this.moveFile(sourcePath, parked);
    try {
      await this.moveFile(temp, newPath);
    } catch (error) {
      // Replacing failed: put the original back exactly where it was.
      await this.moveFile(parked, sourcePath);
      await this.cleanup.removeManifest(assetId);
      throw error;
    }
    // The library must be told what the file now IS, not just where it is.
    // Recording the clock instead of the file's mtime guaranteed the next scan
    // saw it as changed; leaving the old hash guaranteed that ingest then found
    // no matching asset, created a new one, and orphaned this one - which is
    // precisely how a working undo turned into a deleted original.
    const [convertedHash, landed] = await Promise.all([hashFile(newPath), stat(newPath)]);
    await this.db
      .update(assetFile)
      .set({
        relPath: newRelPath,
        fileName: basename(newRelPath),
        sizeBytes: landed.size,
        fsMtime: landed.mtime,
        lastVerifiedAt: new Date(),
      })
      .where(eq(assetFile.id, row.fileId));
    await this.db
      .update(asset)
      .set({
        contentHash: convertedHash,
        videoCodec: codec === 'hevc' ? 'hvc1' : 'h264',
        mime: 'video/mp4',
        updatedAt: new Date(),
      })
      .where(eq(asset.id, assetId));
    // The old playback rendition is stale either way. H.264 streams directly;
    // HEVC gets a fresh rendition queued so playback is ready before first view.
    const playback = resolve(
      this.config.appDataDir,
      'playback',
      assetId.slice(0, 2),
      `${assetId}.mp4`,
    );
    await rm(playback, { force: true }).catch(() => undefined);
    if (codec === 'hevc') {
      await this.queue.enqueue(
        'transcode_playback',
        { assetId },
        { dedupeKey: `transcode_playback:${assetId}`, priority: 190 },
      );
    }
    // Retire the suggestion.
    await this.db
      .insert(cleanupDismissal)
      .values({ assetId, dismissedBy: null })
      .onConflictDoNothing();
    // Into the DB now and, via the rewrite job, into the new mp4's own metadata.
    await applyConfirmedDate();
    this.logger.log(
      `Converted ${row.relPath}: ${row.sizeBytes} → ${converted.size} bytes (original parked for undo).`,
    );
  }

  /**
   * Cross-volume move (library NAS <-> app-data) as copy-then-delete. The
   * source is only removed once the copy is proven complete: a full disk or a
   * dropped mount leaves a short file, and deleting the original on the
   * strength of an unverified copy is how a move becomes a loss.
   */
  private async moveFile(from: string, to: string): Promise<void> {
    try {
      await rename(from, to);
      return;
    } catch {
      // EXDEV or similar - fall through to copy.
    }
    const expected = (await stat(from)).size;
    await copyFile(from, to);
    const landed = await stat(to);
    if (landed.size !== expected) {
      await rm(to, { force: true }).catch(() => undefined);
      throw new Error(
        `Move ${from} -> ${to}: copy is ${landed.size} bytes, expected ${expected}; source left untouched.`,
      );
    }
    await rm(from, { force: true }).catch(() => undefined);
  }
}
