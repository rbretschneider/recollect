import { Inject, Injectable } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';

/** Thumbnail edge sizes generated for every asset (grid / viewer / zoom). */
export const THUMBNAIL_SIZES = [240, 720, 1440] as const;

/** A supported thumbnail edge size. */
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

/** Whether a requested size is one we generate. */
export function isThumbnailSize(value: number): value is ThumbnailSize {
  return (THUMBNAIL_SIZES as readonly number[]).includes(value);
}

/**
 * Owns the on-disk layout of generated thumbnails under the app data directory:
 * `thumbs/<first two hash chars of id>/<assetId>_<size>.webp`. Originals are
 * never written to — this store is the only image output path in the app.
 */
@Injectable()
export class ThumbnailStore {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  pathFor(assetId: string, size: ThumbnailSize): string {
    return join(this.directoryFor(assetId), `${assetId}_${size}.webp`);
  }

  /** Ensures the shard directory for an asset exists and returns it. */
  async ensureDirectoryFor(assetId: string): Promise<string> {
    const directory = this.directoryFor(assetId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private directoryFor(assetId: string): string {
    return join(this.config.appDataDir, 'thumbs', assetId.slice(0, 2));
  }
}
