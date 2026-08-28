import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { album, albumAsset } from '../database/schema';

/** An album card in the album list. */
export interface AlbumSummary {
  id: string;
  title: string;
  coverAssetId: string | null;
  assetCount: number;
  updatedAt: string;
  /** An active public share link exists. */
  isPublic: boolean;
  /** An active guest contribution link exists. */
  hasGuestLink: boolean;
}

/** Full album detail. */
export interface AlbumDetail {
  id: string;
  title: string;
  description: string | null;
  coverAssetId: string | null;
  assetIds: string[];
}

/** Manual photo collections (FRD: albums answer "photos I grouped on purpose"). */
@Injectable()
export class AlbumsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<AlbumSummary[]> {
    const rows = await this.db
      .select({
        id: album.id,
        title: album.title,
        coverAssetId: album.coverAssetId,
        updatedAt: album.updatedAt,
        assetCount: count(albumAsset.assetId),
        // Albums without a chosen cover borrow their first member photo.
        firstMember: sql<string | null>`(
          select aa.asset_id from album_asset aa
          join asset a on a.id = aa.asset_id and a.status = 'active'
          where aa.album_id = ${album.id}
          order by aa.sort_order limit 1
        )`,
        isPublic: sql<boolean>`exists(
          select 1 from share_link sl
          where sl.target_type = 'album' and sl.target_id = ${album.id}
            and sl.revoked_at is null
            and (sl.expires_at is null or sl.expires_at > now())
        )`,
        hasGuestLink: sql<boolean>`exists(
          select 1 from contribution_link cl
          where cl.album_id = ${album.id}
            and cl.revoked_at is null and cl.expires_at > now()
        )`,
      })
      .from(album)
      .leftJoin(albumAsset, eq(albumAsset.albumId, album.id))
      .where(isNull(album.deletedAt))
      .groupBy(album.id)
      .orderBy(desc(album.updatedAt));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      coverAssetId: row.coverAssetId ?? row.firstMember,
      assetCount: row.assetCount,
      updatedAt: row.updatedAt.toISOString(),
      isPublic: row.isPublic,
      hasGuestLink: row.hasGuestLink,
    }));
  }

  async getDetail(albumId: string): Promise<AlbumDetail> {
    const row = await this.requireAlbum(albumId);
    const assetIds = await this.loadAssetIds(albumId);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      coverAssetId: row.coverAssetId ?? assetIds[0] ?? null,
      assetIds,
    };
  }

  async create(userId: string, title: string, assetIds: string[]): Promise<{ albumId: string }> {
    const albumId = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(album).values({
        id: albumId,
        title,
        coverAssetId: assetIds[0] ?? null,
        createdBy: userId,
      });
      if (assetIds.length > 0) {
        await tx.insert(albumAsset).values(
          assetIds.map((assetId, index) => ({ albumId, assetId, sortOrder: index, addedBy: userId })),
        );
      }
    });
    return { albumId };
  }

  async rename(albumId: string, title: string): Promise<void> {
    await this.requireAlbum(albumId);
    await this.db
      .update(album)
      .set({ title, updatedAt: new Date() })
      .where(eq(album.id, albumId));
  }

  async softDelete(albumId: string): Promise<void> {
    await this.requireAlbum(albumId);
    await this.db.update(album).set({ deletedAt: new Date() }).where(eq(album.id, albumId));
  }

  async addAssets(albumId: string, assetIds: string[], userId: string): Promise<void> {
    await this.requireAlbum(albumId);
    const existing = await this.loadAssetIds(albumId);
    const fresh = assetIds.filter((id) => !existing.includes(id));
    if (fresh.length === 0) {
      return;
    }
    await this.db.insert(albumAsset).values(
      fresh.map((assetId, index) => ({
        albumId,
        assetId,
        sortOrder: existing.length + index,
        addedBy: userId,
      })),
    );
    await this.db.update(album).set({ updatedAt: new Date() }).where(eq(album.id, albumId));
  }

  /** Removing from an album never touches files or other collections. */
  async removeAsset(albumId: string, assetId: string): Promise<void> {
    await this.requireAlbum(albumId);
    await this.db
      .delete(albumAsset)
      .where(and(eq(albumAsset.albumId, albumId), eq(albumAsset.assetId, assetId)));
  }

  private async requireAlbum(albumId: string): Promise<typeof album.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(album)
      .where(and(eq(album.id, albumId), isNull(album.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That album does not exist.');
    }
    return row;
  }

  private async loadAssetIds(albumId: string): Promise<string[]> {
    const rows = await this.db
      .select({ assetId: albumAsset.assetId })
      .from(albumAsset)
      .where(eq(albumAsset.albumId, albumId))
      .orderBy(asc(albumAsset.sortOrder));
    return rows.map((row) => row.assetId);
  }
}
