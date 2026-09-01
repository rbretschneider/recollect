import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { exiftool } from 'exiftool-vendored';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { asset, assetFile, libraryRoot } from '../../database/schema';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { REWRITE_CAPTURE_DATE_JOB } from '../assets.service';

/**
 * Writes a user-corrected capture date into the ORIGINAL file's metadata, then
 * re-syncs the derived state: rewriting EXIF changes the bytes, so the content
 * hash and the file's size/mtime must be updated or the next scan would treat
 * it as a brand-new file. Entirely best-effort — a failure leaves the DB date
 * (already corrected) intact and just doesn't touch the file.
 */
@Injectable()
export class RewriteCaptureDateHandler implements JobHandler, OnModuleInit {
  readonly type = REWRITE_CAPTURE_DATE_JOB;
  private readonly logger = new Logger(RewriteCaptureDateHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: unknown): Promise<void> {
    const { assetId, capturedAt, tzOffsetMin } = payload as {
      assetId: string;
      capturedAt: string;
      tzOffsetMin: number;
    };
    const [row] = await this.db
      .select({
        fileId: assetFile.id,
        relPath: assetFile.relPath,
        rootPath: libraryRoot.path,
      })
      .from(assetFile)
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(and(eq(assetFile.assetId, assetId), eq(assetFile.state, 'present')))
      .limit(1);
    if (!row) {
      this.logger.warn(`Rewrite date ${assetId}: no present file; skipping.`);
      return;
    }
    const path = resolve(join(row.rootPath, row.relPath));
    const exifDate = toExifLocal(new Date(capturedAt), tzOffsetMin);
    try {
      // -overwrite_original so we don't litter the NAS with _original backups.
      await exiftool.write(path, { AllDates: exifDate }, ['-overwrite_original']);
    } catch (error) {
      this.logger.warn(`Rewrite date ${assetId}: exiftool write failed: ${(error as Error).message}`);
      return; // DB date stays corrected; the file just isn't updated.
    }
    // The file changed — re-derive hash + fs stats so scans stay consistent.
    try {
      const [hash, stats] = await Promise.all([hashFile(path), stat(path)]);
      await this.db
        .update(assetFile)
        .set({ sizeBytes: stats.size, fsMtime: stats.mtime, lastVerifiedAt: new Date() })
        .where(eq(assetFile.id, row.fileId));
      await this.db
        .update(asset)
        .set({ contentHash: hash, updatedAt: new Date() })
        .where(eq(asset.id, assetId));
    } catch (error) {
      this.logger.warn(`Rewrite date ${assetId}: rehash failed: ${(error as Error).message}`);
    }
  }
}

/** EXIF stores local wall-clock time with no zone: "YYYY:MM:DD HH:MM:SS". */
function toExifLocal(instant: Date, tzOffsetMin: number): string {
  const local = new Date(instant.getTime() + tzOffsetMin * 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${local.getUTCFullYear()}:${pad(local.getUTCMonth() + 1)}:${pad(local.getUTCDate())} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
  );
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
