import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import {
  album,
  albumAsset,
  asset,
  assetFile,
  journalEntry,
  libraryRoot,
  memory,
} from '../database/schema';
import { MlClientService } from '../ml/ml-client.service';
import { DateQueryRange, parseDateQuery } from './date-query';

/** A memory hit in search results. */
export interface SearchMemoryHit {
  id: string;
  title: string;
  startAt: string;
  coverAssetId: string | null;
}

/** An album hit in search results. */
export interface SearchAlbumHit {
  id: string;
  title: string;
  coverAssetId: string | null;
}

/** A folder hit in search results. */
export interface SearchFolderHit {
  rootId: string;
  path: string;
  name: string;
}

/** A named person whose name matches the query. */
export interface SearchPersonHit {
  id: string;
  name: string;
  coverFaceId: string | null;
  faceCount: number;
}

/** A photo/video hit (filename match or date range member). */
export interface SearchAssetHit {
  id: string;
  mediaType: 'image' | 'video';
  capturedAt: string;
  fileName: string;
}

/** Everything one query returns, grouped. */
export interface SearchResults {
  query: string;
  dateRange: { from: string; to: string; label: string } | null;
  memories: SearchMemoryHit[];
  albums: SearchAlbumHit[];
  folders: SearchFolderHit[];
  people: SearchPersonHit[];
  assets: SearchAssetHit[];
  /** CLIP semantic matches ("beach", "kids in snow") — empty when ML is off. */
  semantic: SearchAssetHit[];
}

const MIN_TEXT_LENGTH = 2;
const SEMANTIC_LIMIT = 30;
const SEMANTIC_MAX_DISTANCE = 0.78;
const MEMORY_LIMIT = 20;
const ALBUM_LIMIT = 20;
const FOLDER_LIMIT = 10;
const ASSET_LIMIT = 100;

/**
 * Search v1: one query across memories (title/description/journal), albums,
 * folder paths, filenames, and date expressions ("july 2025", "2023").
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly ml: MlClientService,
  ) {}

  async search(query: string): Promise<SearchResults> {
    const trimmed = query.trim();
    const dateRange = parseDateQuery(trimmed);
    const isTextSearch = trimmed.length >= MIN_TEXT_LENGTH && dateRange === null;
    const [memories, albums, folders, people, assets, semantic] = await Promise.all([
      isTextSearch ? this.searchMemories(trimmed) : Promise.resolve([]),
      isTextSearch ? this.searchAlbums(trimmed) : Promise.resolve([]),
      isTextSearch ? this.searchFolders(trimmed) : Promise.resolve([]),
      isTextSearch ? this.searchPeople(trimmed) : Promise.resolve([]),
      dateRange ? this.assetsInRange(dateRange) : isTextSearch ? this.searchFiles(trimmed) : Promise.resolve([]),
      isTextSearch ? this.searchSemantic(trimmed) : Promise.resolve([]),
    ]);
    return {
      query: trimmed,
      dateRange: dateRange
        ? { from: dateRange.from.toISOString(), to: dateRange.to.toISOString(), label: dateRange.label }
        : null,
      memories,
      albums,
      folders,
      people,
      assets,
      semantic,
    };
  }

  /** CLIP text-to-image search over the embedded library; empty when ML is off. */
  /** Named people whose name contains the query — jumps to their photo page. */
  private async searchPeople(text: string): Promise<SearchPersonHit[]> {
    const result = await this.db.execute<{
      id: string;
      name: string;
      cover_face_id: string | null;
      face_count: number;
    }>(sql`
      select p.id, p.name, p.cover_face_id, count(f.id)::int as face_count
      from person p
      left join face f on f.person_id = p.id and f.ignored = false
      where p.name ilike ${'%' + text + '%'}
        and p.merged_into_id is null and p.hidden = false
      group by p.id, p.name, p.cover_face_id
      order by count(f.id) desc
      limit 8
    `);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      coverFaceId: row.cover_face_id,
      faceCount: row.face_count,
    }));
  }

  private async searchSemantic(text: string): Promise<SearchAssetHit[]> {
    if (!this.ml.isEnabled) {
      return [];
    }
    try {
      const { embedding } = await this.ml.embedText(text);
      if (embedding.length === 0) {
        return [];
      }
      const vectorLiteral = JSON.stringify(embedding);
      const result = await this.db.execute(sql`
        SELECT a.id, a.media_type, a.captured_at,
               e.embedding <=> ${vectorLiteral}::vector AS distance
        FROM asset_embedding e
        JOIN asset a ON a.id = e.asset_id AND a.status = 'active'
        ORDER BY e.embedding <=> ${vectorLiteral}::vector
        LIMIT ${SEMANTIC_LIMIT}
      `);
      return result.rows
        .filter((row) => Number(row.distance) <= SEMANTIC_MAX_DISTANCE)
        .map((row) => ({
          id: row.id as string,
          mediaType: row.media_type as 'image' | 'video',
          capturedAt: new Date(row.captured_at as string).toISOString(),
          fileName: '',
        }));
    } catch {
      return []; // A sick sidecar must never break plain search.
    }
  }

  private async searchMemories(text: string): Promise<SearchMemoryHit[]> {
    const pattern = `%${text}%`;
    const rows = await this.db
      .select({
        id: memory.id,
        title: memory.title,
        startAt: memory.startAt,
        coverAssetId: memory.coverAssetId,
      })
      .from(memory)
      .where(
        and(
          isNull(memory.deletedAt),
          or(
            ilike(memory.title, pattern),
            ilike(memory.description, pattern),
            ilike(memory.locationLabel, pattern),
            sql`exists (select 1 from ${journalEntry} where ${journalEntry.memoryId} = ${memory.id} and ${journalEntry.bodyMd} ilike ${pattern})`,
          ),
        ),
      )
      .orderBy(desc(memory.startAt))
      .limit(MEMORY_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      startAt: row.startAt.toISOString(),
      coverAssetId: row.coverAssetId,
    }));
  }

  private async searchAlbums(text: string): Promise<SearchAlbumHit[]> {
    const rows = await this.db
      .select({
        id: album.id,
        title: album.title,
        coverAssetId: album.coverAssetId,
        firstMember: sql<string | null>`(select ${albumAsset.assetId} from ${albumAsset} where ${albumAsset.albumId} = ${album.id} order by ${albumAsset.sortOrder} limit 1)`,
      })
      .from(album)
      .where(and(isNull(album.deletedAt), ilike(album.title, `%${text}%`)))
      .limit(ALBUM_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      coverAssetId: row.coverAssetId ?? row.firstMember,
    }));
  }

  private async searchFolders(text: string): Promise<SearchFolderHit[]> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT f.root_id, substring(f.rel_path from '^(.*)/[^/]+$') AS dir
      FROM asset_file f
      WHERE f.state = 'present'
        AND substring(f.rel_path from '^(.*)/[^/]+$') ILIKE ${'%' + text + '%'}
      LIMIT ${FOLDER_LIMIT}
    `);
    return result.rows
      .filter((row) => row.dir !== null)
      .map((row) => {
        const path = row.dir as string;
        return {
          rootId: row.root_id as string,
          path,
          name: path.split('/').pop() ?? path,
        };
      });
  }

  private async searchFiles(text: string): Promise<SearchAssetHit[]> {
    const rows = await this.db
      .selectDistinctOn([asset.id], {
        id: asset.id,
        mediaType: asset.mediaType,
        capturedAt: asset.capturedAt,
        fileName: assetFile.fileName,
      })
      .from(assetFile)
      .innerJoin(asset, and(eq(asset.id, assetFile.assetId), eq(asset.status, 'active')))
      .where(and(eq(assetFile.state, 'present'), ilike(assetFile.relPath, `%${text}%`)))
      .limit(ASSET_LIMIT);
    return rows
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .map((row) => this.toAssetHit(row));
  }

  private async assetsInRange(range: DateQueryRange): Promise<SearchAssetHit[]> {
    const rows = await this.db
      .select({
        id: asset.id,
        mediaType: asset.mediaType,
        capturedAt: asset.capturedAt,
        fileName: sql<string>`''`,
      })
      .from(asset)
      .where(
        and(
          eq(asset.status, 'active'),
          sql`${asset.capturedAt} >= ${range.from} and ${asset.capturedAt} < ${range.to}`,
        ),
      )
      .orderBy(desc(asset.capturedAt))
      .limit(ASSET_LIMIT);
    return rows.map((row) => this.toAssetHit(row));
  }

  private toAssetHit(row: {
    id: string;
    mediaType: string;
    capturedAt: Date;
    fileName: string;
  }): SearchAssetHit {
    return {
      id: row.id,
      mediaType: row.mediaType as 'image' | 'video',
      capturedAt: row.capturedAt.toISOString(),
      fileName: row.fileName,
    };
  }
}
