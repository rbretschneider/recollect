import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { exiftool } from 'exiftool-vendored';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';
import sharp from 'sharp';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, libraryRoot } from '../database/schema';
import { rewriteLibraryFileSafely } from '../media/safe-rewrite';
import { ThumbnailService } from '../media/thumbnail.service';

/**
 * EXIF orientation under a 90° clockwise turn. Values 1-4 are the unmirrored
 * cycle, 5-8 the mirrored one; a quarter turn moves each along its own cycle,
 * never between them.
 */
const ROTATE_CW: Record<number, number> = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 };

/** Orientations 5-8 present the image turned, so stored w/h read swapped. */
const TURNED = new Set([5, 6, 7, 8]);

/** Formats with a real EXIF orientation tag — the only ones we can turn losslessly. */
const ROTATABLE_MIME = /^image\/(jpeg|heic|heif|tiff|avif)$/i;

/**
 * Rotates a photo by rewriting its EXIF orientation tag.
 *
 * ## Why this is written the long way round
 *
 * The first version handed the library file straight to exiftool with
 * `-overwrite_original`, which writes a sidecar temp file and renames it over
 * the original. On the CIFS library mount that rename failed and the original
 * did not survive it — a photo was destroyed. Testing it on a copy in /tmp
 * proved nothing, because /tmp is local ext4 and the rename semantics that
 * broke are exactly what differs.
 *
 * So the library file is never handed to a tool that unlinks or renames it, and
 * the original bytes are on local disk before it is touched at all:
 *
 *   1. copy the original to local staging — this is the rollback copy
 *   2. copy that again and let exiftool rewrite the copy, on local disk
 *   3. verify the rewritten copy decodes and carries the expected orientation
 *   4. stream it over the library file (truncate-and-write; never unlink,
 *      never rename)
 *   5. verify what landed, and restore the rollback copy if anything is off
 *
 * At no point does a window exist where neither a good original nor a verified
 * replacement is on disk.
 */
@Injectable()
export class RotateService {
  private readonly logger = new Logger(RotateService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly thumbnails: ThumbnailService,
  ) {}

  async rotate(assetId: string, turns: number): Promise<{ orientation: number }> {
    const [row] = await this.db
      .select({
        mime: asset.mime,
        mediaType: asset.mediaType,
        orientation: asset.orientation,
        width: asset.width,
        height: asset.height,
        fileId: assetFile.id,
        relPath: assetFile.relPath,
        rootPath: libraryRoot.path,
      })
      .from(asset)
      .innerJoin(assetFile, and(eq(assetFile.assetId, asset.id), eq(assetFile.state, 'present')))
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That photo does not exist.');
    }
    if (row.mediaType !== 'image' || !ROTATABLE_MIME.test(row.mime)) {
      throw new BadRequestException('Only photos with an orientation tag can be rotated.');
    }

    const from = normalizeOrientation(row.orientation);
    // Any integer, in either direction, collapses to 0-3 quarter turns clockwise.
    const quarters = ((Math.trunc(turns) % 4) + 4) % 4;
    let to = from;
    for (let i = 0; i < quarters; i++) {
      to = ROTATE_CW[to] ?? to;
    }
    if (to === from) {
      return { orientation: from };
    }

    const livePath = resolve(join(row.rootPath, row.relPath));
    try {
      // Staged, verified, copied over in place - see rewriteLibraryFileSafely
      // for why the library file is never handed to exiftool directly. `-n`
      // writes the raw numeric value; without it exiftool expects the
      // descriptive form and rejects a bare number.
      await rewriteLibraryFileSafely(
        livePath,
        join(this.config.appDataDir, 'staging', 'rotate'),
        assetId,
        {
          rewrite: (working) => exiftool.write(working, { Orientation: to }, ['-overwrite_original', '-n']),
          verify: (candidate) => this.assertUsableImage(candidate, to),
        },
        this.logger,
      );
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'That photo could not be saved to the library, so it was left as it was.',
      );
    }

    // The file changed, so its identity did. Skipping this leaves the stored
    // hash stale and the next scan re-ingests the photo as brand new.
    const [hash, stats] = await Promise.all([hashFile(livePath), stat(livePath)]);

    // Crossing the turned/upright boundary swaps how the image presents.
    const crossed = TURNED.has(from) !== TURNED.has(to);
    const width = crossed ? row.height : row.width;
    const height = crossed ? row.width : row.height;

    await this.db
      .update(assetFile)
      .set({ sizeBytes: stats.size, fsMtime: stats.mtime, lastVerifiedAt: new Date() })
      .where(eq(assetFile.id, row.fileId));
    await this.db
      .update(asset)
      .set({ contentHash: hash, orientation: to, width, height, updatedAt: new Date() })
      .where(eq(asset.id, assetId));

    try {
      await this.thumbnails.generateAll(assetId, livePath, {
        mediaType: 'image',
        mime: row.mime,
      });
    } catch (error) {
      this.logger.warn(
        `Rotated ${assetId} but could not regenerate thumbnails: ${(error as Error).message}`,
      );
    }
    this.logger.log(`Rotated ${assetId} by ${quarters} quarter turn(s): ${from} -> ${to}.`);
    return { orientation: to };
  }

  /**
   * A file is only acceptable if it decodes as an image AND carries the
   * orientation we meant to write. Checking the size alone would happily pass a
   * truncated JPEG.
   */
  private async assertUsableImage(path: string, expectedOrientation: number): Promise<void> {
    const info = await stat(path);
    if (info.size === 0) {
      throw new Error('file is empty');
    }
    const metadata = await sharp(path).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('file does not decode as an image');
    }
    if (metadata.orientation !== expectedOrientation) {
      throw new Error(
        `orientation is ${metadata.orientation ?? 'unset'}, expected ${expectedOrientation}`,
      );
    }
  }

}

/** Missing or nonsensical orientation is treated as upright. */
function normalizeOrientation(value: number | null): number {
  return value !== null && value >= 1 && value <= 8 ? value : 1;
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}
