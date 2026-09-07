import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { exiftool } from 'exiftool-vendored';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, libraryRoot } from '../database/schema';
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
 * Nothing is re-encoded: the compressed image data is untouched and only a
 * metadata tag changes, so this is lossless no matter how many times it runs.
 * Thumbnails come out correct for free because the thumbnailer already
 * auto-orients from that same tag.
 *
 * Synchronous by design — the user asked for it on disk immediately, and the
 * whole operation is a metadata write plus a rehash.
 */
@Injectable()
export class RotateService {
  private readonly logger = new Logger(RotateService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly thumbnails: ThumbnailService,
  ) {}

  async rotate(assetId: string, turns: number): Promise<{ orientation: number }> {
    // DISABLED 2026-09-07 after this destroyed an original.
    //
    // exiftool -overwrite_original writes a sidecar temp file and renames it
    // over the original. On the CIFS library mount that rename failed
    // ("Error renaming temporary file to …") and the original did not survive
    // it — the photo is simply gone, while the database still lists it present.
    //
    // Nothing may write to a file in the library again until the write path is
    // proven safe on this filesystem: stage the rewrite on local disk, verify
    // the result decodes and is the expected size, and only then put it back.
    throw new ServiceUnavailableException(
      'Rotating is turned off while a problem with saving to the library is fixed.',
    );
    // eslint-disable-next-line no-unreachable
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
    const quarters = (((Math.trunc(turns) % 4) + 4) % 4);
    let to = from;
    for (let i = 0; i < quarters; i++) {
      to = ROTATE_CW[to] ?? to;
    }
    if (to === from) {
      return { orientation: from };
    }
    const path = resolve(join(row.rootPath, row.relPath));

    // `-n` writes the raw numeric value; without it exiftool expects the
    // descriptive form ("Rotate 90 CW") and silently rejects a bare number.
    await exiftool.write(path, { Orientation: to }, ['-overwrite_original', '-n']);

    // The file's bytes changed, so its identity did. Skipping this leaves the
    // stored hash stale and the next scan re-ingests it as a brand-new photo.
    const [hash, stats] = await Promise.all([hashFile(path), stat(path)]);

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

    // Regenerate now rather than in the background: a rotate the grid doesn't
    // reflect reads as a failure, and the thumbnailer auto-orients from EXIF.
    try {
      await this.thumbnails.generateAll(assetId, path, { mediaType: 'image', mime: row.mime });
    } catch (error) {
      this.logger.warn(
        `Rotated ${assetId} but could not regenerate thumbnails: ${(error as Error).message}`,
      );
    }
    this.logger.log(`Rotated ${assetId} by ${quarters} quarter turn(s): orientation ${from} -> ${to}.`);
    return { orientation: to };
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
