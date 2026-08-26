import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { access, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import sharp from 'sharp';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { face } from '../database/schema';
import { ThumbnailStore } from '../media/thumbnail-store';

const CROP_SIZE = 240;
const CROP_MARGIN = 0.35;
const SOURCE_THUMB_SIZE = 720 as const;

/**
 * Square face crops for the People UI — judging "is this the same person?"
 * needs faces, not whole photos. Crops are cut from the 720 thumbnail using
 * the stored normalized bbox (plus margin) and cached under app data.
 */
@Injectable()
export class FaceCropService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly thumbnails: ThumbnailStore,
  ) {}

  /** Returns the absolute path of the cached crop, rendering it on first request. */
  async getCropPath(faceId: string): Promise<string> {
    const cropPath = resolve(this.pathFor(faceId));
    if (await this.exists(cropPath)) {
      return cropPath;
    }
    const [row] = await this.db
      .select({ assetId: face.assetId, bbox: face.bbox })
      .from(face)
      .where(eq(face.id, faceId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That face does not exist.');
    }
    await this.render(row.assetId, row.bbox, cropPath);
    return cropPath;
  }

  private async render(assetId: string, bbox: number[], cropPath: string): Promise<void> {
    const sourcePath = this.thumbnails.pathFor(assetId, SOURCE_THUMB_SIZE);
    const image = sharp(sourcePath);
    const meta = await image.metadata();
    const width = meta.width ?? 1;
    const height = meta.height ?? 1;
    const [x, y, w, h] = bbox;
    // Expand the box by a margin and clamp to the image.
    const marginX = w * CROP_MARGIN;
    const marginY = h * CROP_MARGIN;
    const left = Math.max(0, Math.round((x - marginX) * width));
    const top = Math.max(0, Math.round((y - marginY) * height));
    const cropWidth = Math.min(width - left, Math.round((w + 2 * marginX) * width));
    const cropHeight = Math.min(height - top, Math.round((h + 2 * marginY) * height));
    await mkdir(join(this.config.appDataDir, 'faces'), { recursive: true });
    await image
      .extract({ left, top, width: Math.max(1, cropWidth), height: Math.max(1, cropHeight) })
      .resize(CROP_SIZE, CROP_SIZE, { fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(cropPath);
  }

  private pathFor(faceId: string): string {
    return join(this.config.appDataDir, 'faces', `${faceId}.webp`);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
