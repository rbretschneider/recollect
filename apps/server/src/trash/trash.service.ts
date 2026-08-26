import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetFile, auditLog, libraryRoot, memoryAsset } from '../database/schema';
import { THUMBNAIL_SIZES, ThumbnailStore } from '../media/thumbnail-store';
import { safeMoveFile } from './safe-file-move';

/** A trashed item as shown in the Trash view. */
export interface TrashItem {
  assetId: string;
  fileName: string;
  trashedAt: string;
  trashedByName: string | null;
  purgeAt: string;
}

/** Directory name (inside each library root) that holds trashed originals. */
export const TRASH_DIRECTORY_NAME = '.recollect-trash';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Delete → Trash → Restore → Purge (FRD stories S5.1–S5.3). Trashing physically
 * moves the original into the root's trash folder (same volume, instant) and is
 * restorable until the holding period elapses. Memory/journal references are
 * never removed — a trashed asset renders as a tombstone.
 */
@Injectable()
export class TrashService {
  private readonly logger = new Logger(TrashService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly thumbnails: ThumbnailStore,
  ) {}

  /** Moves the originals of the given assets into trash. */
  async trashAssets(assetIds: string[], userId: string): Promise<{ trashed: number }> {
    let trashed = 0;
    for (const assetId of assetIds) {
      if (await this.trashOne(assetId, userId)) {
        trashed++;
      }
    }
    return { trashed };
  }

  /** Restores trashed assets to their original locations. */
  async restoreAssets(assetIds: string[], userId: string): Promise<{ restored: number }> {
    let restored = 0;
    for (const assetId of assetIds) {
      if (await this.restoreOne(assetId, userId)) {
        restored++;
      }
    }
    return { restored };
  }

  async listTrash(): Promise<TrashItem[]> {
    const rows = await this.db.select().from(asset).where(eq(asset.status, 'trashed'));
    const items: TrashItem[] = [];
    for (const row of rows) {
      const [file] = await this.db
        .select({ fileName: assetFile.fileName })
        .from(assetFile)
        .where(and(eq(assetFile.assetId, row.id), eq(assetFile.state, 'trashed')))
        .limit(1);
      const trashedAt = row.trashedAt ?? new Date();
      items.push({
        assetId: row.id,
        fileName: file?.fileName ?? '(unknown)',
        trashedAt: trashedAt.toISOString(),
        trashedByName: null,
        purgeAt: new Date(
          trashedAt.getTime() + this.config.trashRetentionDays * MILLISECONDS_PER_DAY,
        ).toISOString(),
      });
    }
    return items;
  }

  /** Permanently deletes items past the holding period (or everything when forced). */
  async purgeExpired(force = false): Promise<{ purged: number }> {
    const cutoff = force
      ? new Date()
      : new Date(Date.now() - this.config.trashRetentionDays * MILLISECONDS_PER_DAY);
    const expired = await this.db
      .select({ id: asset.id })
      .from(asset)
      .where(and(eq(asset.status, 'trashed'), lt(asset.trashedAt, cutoff)));
    for (const row of expired) {
      await this.purgeOne(row.id);
    }
    if (expired.length > 0) {
      this.logger.log(`Purged ${expired.length} trashed assets.`);
    }
    return { purged: expired.length };
  }

  private async trashOne(assetId: string, userId: string): Promise<boolean> {
    const files = await this.loadFilesWithRoots(assetId, 'present');
    if (files.length === 0) {
      return false;
    }
    const day = new Date().toISOString().slice(0, 10);
    for (const file of files) {
      const sourcePath = join(file.rootPath, file.relPath);
      const destinationPath = join(
        file.rootPath,
        TRASH_DIRECTORY_NAME,
        day,
        file.relPath.replaceAll('/', '_'),
      );
      const finalPath = await safeMoveFile(sourcePath, destinationPath);
      await this.db
        .update(assetFile)
        .set({ state: 'trashed', trashPath: finalPath, originalRelPath: file.relPath })
        .where(eq(assetFile.id, file.fileId));
    }
    await this.db
      .update(asset)
      .set({ status: 'trashed', trashedAt: new Date(), trashedBy: userId, updatedAt: new Date() })
      .where(eq(asset.id, assetId));
    await this.audit(userId, 'asset.trash', assetId, { files: files.map((file) => file.relPath) });
    return true;
  }

  private async restoreOne(assetId: string, userId: string): Promise<boolean> {
    const files = await this.loadFilesWithRoots(assetId, 'trashed');
    if (files.length === 0) {
      return false;
    }
    for (const file of files) {
      if (!file.trashPath || !file.originalRelPath) {
        continue;
      }
      const destinationPath = join(file.rootPath, file.originalRelPath);
      const finalPath = await safeMoveFile(file.trashPath, destinationPath);
      await this.db
        .update(assetFile)
        .set({
          state: 'present',
          trashPath: null,
          originalRelPath: null,
          relPath: this.toRelPath(finalPath, file.rootPath),
        })
        .where(eq(assetFile.id, file.fileId));
    }
    await this.db
      .update(asset)
      .set({ status: 'active', trashedAt: null, trashedBy: null, updatedAt: new Date() })
      .where(eq(asset.id, assetId));
    await this.audit(userId, 'asset.restore', assetId, {});
    return true;
  }

  /** Deletes trash files + thumbnails; keeps the asset row as a tombstone when a Memory references it. */
  private async purgeOne(assetId: string): Promise<void> {
    const files = await this.loadFilesWithRoots(assetId, 'trashed');
    for (const file of files) {
      if (file.trashPath) {
        await this.deleteQuietly(file.trashPath);
      }
    }
    for (const size of THUMBNAIL_SIZES) {
      await this.deleteQuietly(this.thumbnails.pathFor(assetId, size));
    }
    await this.db.delete(assetFile).where(eq(assetFile.assetId, assetId));
    const [referenced] = await this.db
      .select({ assetId: memoryAsset.assetId })
      .from(memoryAsset)
      .where(eq(memoryAsset.assetId, assetId))
      .limit(1);
    if (referenced) {
      await this.db
        .update(asset)
        .set({ status: 'missing', updatedAt: new Date() })
        .where(eq(asset.id, assetId));
    } else {
      await this.db.delete(asset).where(eq(asset.id, assetId));
    }
    await this.audit(null, 'trash.purge', assetId, {});
  }

  private async loadFilesWithRoots(
    assetId: string,
    state: 'present' | 'trashed',
  ): Promise<
    Array<{
      fileId: string;
      relPath: string;
      rootPath: string;
      trashPath: string | null;
      originalRelPath: string | null;
    }>
  > {
    return this.db
      .select({
        fileId: assetFile.id,
        relPath: assetFile.relPath,
        rootPath: libraryRoot.path,
        trashPath: assetFile.trashPath,
        originalRelPath: assetFile.originalRelPath,
      })
      .from(assetFile)
      .innerJoin(libraryRoot, eq(libraryRoot.id, assetFile.rootId))
      .where(and(eq(assetFile.assetId, assetId), eq(assetFile.state, state)));
  }

  private toRelPath(absolutePath: string, rootPath: string): string {
    return absolutePath.slice(rootPath.length).replace(/^[\\/]/, '').replaceAll('\\', '/');
  }

  private async deleteQuietly(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // Already gone is fine; purge must be idempotent.
    }
  }

  private async audit(
    userId: string | null,
    action: string,
    assetId: string,
    detail: object,
  ): Promise<void> {
    await this.db.insert(auditLog).values({
      id: uuidv7(),
      userId,
      action,
      entityType: 'asset',
      entityId: assetId,
      detail,
    });
  }
}
