import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { libraryRoot } from '../database/schema';

/** A subfolder entry in the folder browser. */
export interface FolderEntry {
  name: string;
  /** Path relative to the root, e.g. "2019/Maine Trip". */
  path: string;
  /** Recursive count of active assets underneath. */
  assetCount: number;
  coverAssetId: string | null;
}

/** An asset directly inside the browsed folder. */
export interface FolderAsset {
  id: string;
  mediaType: 'image' | 'video';
  capturedAt: string;
  fileName: string;
  hasThumbnail: boolean;
}

/** One level of the filesystem-shaped library view. */
export interface FolderListing {
  rootId: string;
  rootName: string;
  path: string;
  folders: FolderEntry[];
  assets: FolderAsset[];
}

/** A library root shown at the top level of the folder browser. */
export interface RootEntry {
  rootId: string;
  name: string;
  assetCount: number;
  coverAssetId: string | null;
}

/**
 * Browses the library by its on-disk folder structure (PhotoPrism-style
 * Folders view). The hierarchy is derived from asset_file.rel_path — the
 * user's own organization on disk is the navigation.
 */
@Injectable()
export class FoldersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Top level: every enabled root with recursive count and a cover. */
  async listRoots(): Promise<RootEntry[]> {
    const result = await this.db.execute(sql`
      SELECT r.id AS root_id, r.name,
             count(a.id) AS asset_count,
             (ARRAY_REMOVE(ARRAY_AGG(a.id ORDER BY a.captured_at DESC), NULL))[1] AS cover_asset_id
      FROM library_root r
      LEFT JOIN asset_file f ON f.root_id = r.id AND f.state = 'present'
      LEFT JOIN asset a ON a.id = f.asset_id AND a.status = 'active'
      WHERE r.enabled = true
      GROUP BY r.id, r.name
      ORDER BY r.name
    `);
    return result.rows.map((row) => ({
      rootId: row.root_id as string,
      name: row.name as string,
      assetCount: Number(row.asset_count),
      coverAssetId: (row.cover_asset_id as string | null) ?? null,
    }));
  }

  /** One folder level: immediate subfolders plus the assets directly inside. */
  async browse(rootId: string, path: string): Promise<FolderListing> {
    const normalizedPath = this.normalizePath(path);
    const [root] = await this.db
      .select({ id: libraryRoot.id, name: libraryRoot.name })
      .from(libraryRoot)
      .where(eq(libraryRoot.id, rootId))
      .limit(1);
    if (!root) {
      throw new NotFoundException('That library root does not exist.');
    }
    const prefix = normalizedPath.length > 0 ? `${normalizedPath}/` : '';
    return {
      rootId: root.id,
      rootName: root.name,
      path: normalizedPath,
      folders: await this.listSubfolders(rootId, prefix, normalizedPath),
      assets: await this.listDirectAssets(rootId, prefix),
    };
  }

  private async listSubfolders(
    rootId: string,
    prefix: string,
    basePath: string,
  ): Promise<FolderEntry[]> {
    const result = await this.db.execute(sql`
      SELECT split_part(substring(f.rel_path from (${prefix.length + 1})::int), '/', 1) AS name,
             count(a.id) AS asset_count,
             (ARRAY_REMOVE(ARRAY_AGG(a.id ORDER BY a.captured_at DESC), NULL))[1] AS cover_asset_id
      FROM asset_file f
      JOIN asset a ON a.id = f.asset_id AND a.status = 'active'
      WHERE f.root_id = ${rootId}
        AND f.state = 'present'
        AND f.rel_path LIKE ${prefix + '%'}
        AND position('/' IN substring(f.rel_path from (${prefix.length + 1})::int)) > 0
      GROUP BY name
      ORDER BY name
    `);
    return result.rows.map((row) => {
      const name = row.name as string;
      return {
        name,
        path: basePath.length > 0 ? `${basePath}/${name}` : name,
        assetCount: Number(row.asset_count),
        coverAssetId: (row.cover_asset_id as string | null) ?? null,
      };
    });
  }

  private async listDirectAssets(rootId: string, prefix: string): Promise<FolderAsset[]> {
    const result = await this.db.execute(sql`
      SELECT a.id, a.media_type, a.captured_at, f.file_name,
             (a.stage_thumbs_at IS NOT NULL) AS has_thumbnail
      FROM asset_file f
      JOIN asset a ON a.id = f.asset_id AND a.status = 'active'
      WHERE f.root_id = ${rootId}
        AND f.state = 'present'
        AND f.rel_path LIKE ${prefix + '%'}
        AND position('/' IN substring(f.rel_path from (${prefix.length + 1})::int)) = 0
      ORDER BY a.captured_at DESC, a.id DESC
    `);
    return result.rows.map((row) => ({
      id: row.id as string,
      mediaType: row.media_type as 'image' | 'video',
      capturedAt: new Date(row.captured_at as string).toISOString(),
      fileName: row.file_name as string,
      hasThumbnail: row.has_thumbnail as boolean,
    }));
  }

  /** Rejects traversal and normalizes separators; empty string = the root itself. */
  private normalizePath(path: string): string {
    const normalized = path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
    if (normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
      throw new BadRequestException('Invalid folder path.');
    }
    return normalized;
  }
}
