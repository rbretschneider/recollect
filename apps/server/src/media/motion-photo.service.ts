import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { exiftool } from 'exiftool-vendored';
import { access, mkdir, open, readdir, rm, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset } from '../database/schema';

/**
 * Android/Pixel/Samsung "motion photos" carry a short MP4 embedded inside the
 * JPEG. We extract that clip once into the app-data cache so the viewer can
 * play it (press-and-hold), the same way Google Photos does. Entirely
 * best-effort and off the critical path: any failure just leaves a normal
 * still photo — never blocks or breaks the image (the prime directive).
 */
@Injectable()
export class MotionPhotoService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MotionPhotoService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /**
   * Reconcile the asset.motion_photo flag with the clip cache once at boot —
   * covers clips extracted before the flag column existed. Best-effort.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const ids = await this.cachedAssetIds();
      if (ids.length > 0) {
        await this.db.update(asset).set({ motionPhoto: true }).where(inArray(asset.id, ids));
        this.logger.log(`Motion-photo flag reconciled for ${ids.length} cached clip(s).`);
      }
    } catch (error) {
      this.logger.warn(`Motion-photo boot reconcile skipped: ${(error as Error).message}`);
    }
  }

  /** Asset ids that currently have a cached motion clip on disk. */
  private async cachedAssetIds(): Promise<string[]> {
    const root = join(this.config.appDataDir, 'motion');
    const ids: string[] = [];
    let shards: string[];
    try {
      shards = await readdir(root);
    } catch {
      return ids; // No motion cache yet.
    }
    for (const shard of shards) {
      let files: string[];
      try {
        files = await readdir(join(root, shard));
      } catch {
        continue;
      }
      for (const file of files) {
        const match = /^([0-9a-f-]{36})\.mp4$/.exec(file);
        if (match) {
          ids.push(match[1]);
        }
      }
    }
    return ids;
  }

  /** Cached embedded clip for an asset (may not exist). */
  motionPathFor(assetId: string): string {
    return join(this.config.appDataDir, 'motion', assetId.slice(0, 2), `${assetId}.mp4`);
  }

  /** True once the embedded clip has been extracted and cached. */
  async hasMotion(assetId: string): Promise<boolean> {
    try {
      await access(this.motionPathFor(assetId));
      return true;
    } catch {
      return false;
    }
  }

  /** Removes the cached clip (used when an asset is reprocessed or purged). */
  async removeMotion(assetId: string): Promise<void> {
    await rm(this.motionPathFor(assetId), { force: true }).catch(() => undefined);
  }

  /**
   * If the file is a motion photo, extract its embedded MP4 into the cache.
   * Returns whether a clip was cached. Never throws — a garnish, not a gate.
   */
  async extractIfPresent(
    assetId: string,
    sourcePath: string,
    rawTags: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.looksLikeMotionPhoto(rawTags)) {
      return false;
    }
    const destination = this.motionPathFor(assetId);
    try {
      await mkdir(dirname(destination), { recursive: true });
      // exiftool surfaces the clip under one of these tags depending on the
      // maker (Google MicroVideo vs. the MotionPhoto v1 container).
      for (const tag of ['EmbeddedVideoFile', 'MotionPhotoVideo']) {
        try {
          await exiftool.extractBinaryTag(tag, sourcePath, destination);
          if (await this.isNonEmpty(destination)) {
            return true;
          }
        } catch {
          // Tag absent for this maker — try the next.
        }
      }
      // Older Google MicroVideo: the clip is simply the trailing N bytes.
      if (await this.extractByTrailingOffset(destination, sourcePath, rawTags)) {
        return true;
      }
      await rm(destination, { force: true }).catch(() => undefined);
    } catch (error) {
      this.logger.warn(`Motion-photo extract failed for ${assetId}: ${(error as Error).message}`);
      await rm(destination, { force: true }).catch(() => undefined);
    }
    return false;
  }

  private looksLikeMotionPhoto(tags: Record<string, unknown>): boolean {
    return (
      tags['MotionPhoto'] === 1 ||
      tags['MicroVideo'] === 1 ||
      tags['MotionPhotoVideo'] != null ||
      tags['EmbeddedVideoType'] != null ||
      typeof tags['MicroVideoOffset'] === 'number'
    );
  }

  /** MicroVideoOffset counts bytes from EOF; slice those out as the clip. */
  private async extractByTrailingOffset(
    destination: string,
    sourcePath: string,
    tags: Record<string, unknown>,
  ): Promise<boolean> {
    const offset = tags['MicroVideoOffset'];
    if (typeof offset !== 'number' || offset <= 0) {
      return false;
    }
    const info = await stat(sourcePath);
    const start = info.size - offset;
    if (start <= 0 || start >= info.size) {
      return false;
    }
    const source = await open(sourcePath, 'r');
    try {
      const buffer = Buffer.alloc(offset);
      await source.read(buffer, 0, offset, start);
      const out = await open(destination, 'w');
      try {
        await out.write(buffer);
      } finally {
        await out.close();
      }
    } finally {
      await source.close();
    }
    return this.isNonEmpty(destination);
  }

  private async isNonEmpty(path: string): Promise<boolean> {
    try {
      const info = await stat(path);
      return info.size > 0;
    } catch {
      return false;
    }
  }
}
