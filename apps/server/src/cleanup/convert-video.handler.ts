import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { and, eq } from 'drizzle-orm';
import ffmpegPath from 'ffmpeg-static';
import { copyFile, mkdir, rename, rm, stat } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, cleanupDismissal, libraryRoot } from '../database/schema';
import { JobHandler, JobHandlerRegistry } from '../jobs/job-handler';
import { JobQueueService } from '../jobs/job-queue.service';
import { CleanupService, CONVERT_VIDEO_JOB } from './cleanup.service';

const execFileAsync = promisify(execFile);
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
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId, codec = 'hevc' } = payload as { assetId: string; codec?: 'hevc' | 'h264' };
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
      })
      .from(assetFile)
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(and(eq(assetFile.assetId, assetId), eq(assetFile.state, 'present')))
      .limit(1);
    if (!row) {
      this.logger.warn(`Convert ${assetId}: no present file; skipping.`);
      return;
    }
    const sourcePath = join(row.rootPath, row.relPath);
    const temp = resolve(this.config.appDataDir, 'staging', `convert_${assetId}.mp4`);
    await mkdir(dirname(temp), { recursive: true });
    this.logger.log(`Converting ${sourcePath}…`);
    // HEVC (~40% smaller, the archive choice; playback renditions cover old
    // browsers) or H.264 (plays natively everywhere, incl. old set-top boxes).
    const videoArgs =
      codec === 'hevc'
        ? ['-c:v', 'libx265', '-preset', 'medium', '-crf', '26', '-tag:v', 'hvc1']
        : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23'];
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
    const converted = await stat(temp);
    // Validity gate BEFORE anything is swapped: the encode must be a COMPLETE,
    // readable video — not just a smaller file. A failed/interrupted ffmpeg run
    // (a DV source with bitstream errors, a full disk, an OOM kill) leaves a
    // truncated file with no moov atom that is tiny; the "smaller = success"
    // heuristic below would otherwise treat that as great compression and
    // replace a good original with garbage. Compare durations: the output must
    // run at least 90% as long as the source, or we abort and keep the original.
    const [sourceSeconds, outputSeconds] = await Promise.all([
      this.probeDurationSeconds(sourcePath),
      this.probeDurationSeconds(temp),
    ]);
    const outputIsComplete =
      outputSeconds !== null &&
      outputSeconds > 0 &&
      (sourceSeconds === null || outputSeconds >= sourceSeconds * 0.9);
    if (!outputIsComplete) {
      await rm(temp, { force: true });
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
      return;
    }
    // Undo window: the original parks in converted-originals for the trash
    // retention period before the purge sweep removes it.
    await this.cleanup.ensureDirs();
    const parked = join(
      this.cleanup.convertedOriginalsDir,
      `${assetId}_${basename(row.relPath)}`,
    );
    await this.moveFile(sourcePath, parked);
    const newRelPath = row.relPath.replace(/\.[^./\\]+$/, '.mp4');
    const newPath = join(row.rootPath, newRelPath);
    try {
      await this.moveFile(temp, newPath);
    } catch (error) {
      // Replacing failed: put the original back exactly where it was.
      await this.moveFile(parked, sourcePath);
      throw error;
    }
    await this.db
      .update(assetFile)
      .set({
        relPath: newRelPath,
        fileName: basename(newRelPath),
        sizeBytes: converted.size,
        fsMtime: new Date(),
        lastVerifiedAt: new Date(),
      })
      .where(eq(assetFile.id, row.fileId));
    await this.db
      .update(asset)
      .set({ videoCodec: codec === 'hevc' ? 'hvc1' : 'h264', mime: 'video/mp4', updatedAt: new Date() })
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
    this.logger.log(
      `Converted ${row.relPath}: ${row.sizeBytes} → ${converted.size} bytes (original parked for undo).`,
    );
  }

  /**
   * Reads a media file's duration in seconds by parsing ffmpeg's own probe
   * output (we ship ffmpeg, not ffprobe). Returns null when the file has no
   * readable duration — a truncated/corrupt output prints no "Duration:" line.
   */
  private async probeDurationSeconds(path: string): Promise<number | null> {
    let stderr = '';
    try {
      // No output target → ffmpeg exits non-zero after printing stream info;
      // the duration we want is on stderr either way.
      await execFileAsync(ffmpegPath as string, ['-hide_banner', '-i', path], {
        maxBuffer: FFMPEG_MAX_BUFFER_BYTES,
      });
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? '');
    }
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) {
      return null;
    }
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  private async moveFile(from: string, to: string): Promise<void> {
    try {
      await rename(from, to);
    } catch {
      await copyFile(from, to);
      await rm(from, { force: true }).catch(() => undefined);
    }
  }
}
