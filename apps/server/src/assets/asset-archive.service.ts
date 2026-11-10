import { Injectable } from '@nestjs/common';
import archiver from 'archiver';
import type { Response } from 'express';
import { extname } from 'node:path';
import { AssetsService } from './assets.service';

/** Appends " (2)", " (3)"... before the extension until `name` is unused, and records it. */
export function uniqueEntryName(name: string, used: Set<string>): string {
  let candidate = name;
  if (used.has(candidate)) {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    let counter = 2;
    do {
      candidate = `${stem} (${counter})${ext}`;
      counter += 1;
    } while (used.has(candidate));
  }
  used.add(candidate);
  return candidate;
}

/** Streams originals as a store-only ZIP; shared by the album and bulk downloads. */
@Injectable()
export class AssetArchiveService {
  constructor(private readonly assets: AssetsService) {}

  async streamZip(
    res: Response,
    zipName: string,
    assetIds: string[],
  ): Promise<void> {
    res.type('application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${zipName}.zip"`,
    );
    const archive = archiver('zip', { store: true });
    let aborted = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        aborted = true;
        archive.abort();
      }
    });
    archive.on('error', () => res.destroy());
    archive.pipe(res);
    const usedNames = new Set<string>();
    for (const assetId of new Set(assetIds)) {
      if (aborted) {
        return;
      }
      try {
        const file = await this.assets.getOriginalFile(assetId);
        const name = await this.assets.getDownloadName(assetId);
        archive.file(file.path, { name: uniqueEntryName(name, usedNames) });
      } catch {
        // A missing original is skipped rather than failing the whole ZIP.
      }
    }
    if (!aborted) {
      await archive.finalize();
    }
  }
}
