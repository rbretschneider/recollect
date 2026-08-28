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
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId } = payload as { assetId: string };
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
    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-loglevel', 'error',
        '-threads', String(this.config.transcodeThreads),
        '-i', sourcePath,
        '-map_metadata', '0',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        temp,
      ],
      { maxBuffer: FFMPEG_MAX_BUFFER_BYTES },
    );
    const converted = await stat(temp);
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
      .set({ videoCodec: 'h264', mime: 'video/mp4', updatedAt: new Date() })
      .where(eq(asset.id, assetId));
    // The old playback rendition (if any) is stale; H.264 streams directly.
    const playback = resolve(
      this.config.appDataDir,
      'playback',
      assetId.slice(0, 2),
      `${assetId}.mp4`,
    );
    await rm(playback, { force: true }).catch(() => undefined);
    // Retire the suggestion.
    await this.db
      .insert(cleanupDismissal)
      .values({ assetId, dismissedBy: null })
      .onConflictDoNothing();
    this.logger.log(
      `Converted ${row.relPath}: ${row.sizeBytes} → ${converted.size} bytes (original parked for undo).`,
    );
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
