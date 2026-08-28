import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { copyFile, mkdir, rename, rm, stat } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { v7 as uuidv7 } from 'uuid';
import { AlbumsService } from '../albums/albums.service';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { album, assetFile, contributionLink, guestUpload, libraryRoot } from '../database/schema';
import { IngestService } from '../library/ingest.service';
import { classifyMediaFile } from '../media/media-types';
import { ThumbnailService } from '../media/thumbnail.service';

/** A contribution link as shown to household members. */
export interface ContributionLinkView {
  id: string;
  token: string;
  poolView: boolean;
  expiresAt: string;
  uploadCount: number;
  createdAt: string;
}

/** One album entry as shown to guests (media type drives the viewer). */
export interface PoolItem {
  id: string;
  mediaType: 'image' | 'video';
}

/** What a guest sees when opening a contribution link. */
export interface ContributeView {
  albumTitle: string;
  poolView: boolean;
  expiresAt: string;
  /** The whole album, in album order — only populated when poolView is on. */
  poolItems: PoolItem[];
}

/** One quarantined upload in the review list. */
export interface GuestUploadView {
  id: string;
  uploaderName: string;
  originalFilename: string;
  sizeBytes: number;
  mediaType: string;
  status: string;
  createdAt: string;
}

/** Guests can't be trusted with unbounded links: hard per-link ceiling. */
const MAX_UPLOADS_PER_LINK = 500;
/** Sliding-window rate limit per link+IP: enough for a burst, not a flood. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 30;
const TOKEN_BYTES = 24;
const DEFAULT_EXPIRES_HOURS = 24 * 7;

/**
 * The guest-upload ("event") flow: a public contribution link on an album,
 * files quarantined in staging until a household member approves them into
 * the library through the normal ingest pipeline (docs/ROADMAP.md design).
 */
@Injectable()
export class ContributionsService {
  private readonly logger = new Logger(ContributionsService.name);
  /** link+IP → recent upload timestamps (pruned on use; resets on restart, which is fine). */
  private readonly recentUploads = new Map<string, number[]>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly albums: AlbumsService,
    private readonly ingest: IngestService,
    private readonly thumbnails: ThumbnailService,
  ) {}

  // Absolute paths throughout: res.sendFile refuses relative ones, and a
  // library_root row must not depend on the process's working directory.
  get stagingDir(): string {
    return resolve(this.config.appDataDir, 'staging');
  }

  /**
   * Where approved guest photos live permanently, registered as a library
   * root. GUEST_LIBRARY_DIR points this at the NAS so guest originals ride
   * the same backups as everything else; unset falls back to the app-data
   * volume (the only originals that would live in Docker — set the env!).
   */
  private get guestLibraryDir(): string {
    return this.config.guestLibraryDir.trim().length > 0
      ? resolve(this.config.guestLibraryDir)
      : resolve(this.config.appDataDir, 'guest-library');
  }

  async createLink(
    albumId: string,
    userId: string,
    poolView: boolean,
    expiresInHours: number,
  ): Promise<ContributionLinkView> {
    await this.requireAlbum(albumId);
    const [row] = await this.db
      .insert(contributionLink)
      .values({
        id: uuidv7(),
        token: randomBytes(TOKEN_BYTES).toString('base64url'),
        albumId,
        poolView,
        createdBy: userId,
        expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      })
      .returning();
    return this.toLinkView(row);
  }

  async listLinksFor(albumId: string): Promise<ContributionLinkView[]> {
    const rows = await this.db
      .select()
      .from(contributionLink)
      .where(and(eq(contributionLink.albumId, albumId), isNull(contributionLink.revokedAt)));
    return rows.map((row) => this.toLinkView(row));
  }

  async revoke(linkId: string): Promise<void> {
    await this.db
      .update(contributionLink)
      .set({ revokedAt: new Date() })
      .where(eq(contributionLink.id, linkId));
  }

  /** Public: what the guest page renders. Only ever exposes this album's approved pool. */
  async getContributeView(token: string): Promise<ContributeView> {
    const link = await this.requireActiveLink(token);
    const [albumRow] = await this.db
      .select({ title: album.title })
      .from(album)
      .where(eq(album.id, link.albumId))
      .limit(1);
    if (!albumRow) {
      throw new NotFoundException('This link is no longer available.');
    }
    let poolItems: PoolItem[] = [];
    if (link.poolView) {
      // The WHOLE album, not just guest uploads: guests at the party see the
      // shared album grow — theirs and everyone else's alike.
      const result = await this.db.execute<{ id: string; media_type: 'image' | 'video' }>(sql`
        select a.id, a.media_type
        from album_asset aa
        join asset a on a.id = aa.asset_id and a.status = 'active'
        where aa.album_id = ${link.albumId}
        order by aa.sort_order
      `);
      poolItems = result.rows.map((row) => ({ id: row.id, mediaType: row.media_type }));
    }
    return {
      albumTitle: albumRow.title,
      poolView: link.poolView,
      expiresAt: link.expiresAt.toISOString(),
      poolItems,
    };
  }

  /**
   * Public: registers one uploaded file into quarantine. The file was already
   * streamed to a temp name in staging by multer; here it's validated (real
   * media by extension AND by decoding a preview), renamed to its durable
   * staging name, and recorded as pending.
   */
  async registerUpload(
    token: string,
    uploaderName: string,
    clientIp: string,
    file: { originalname: string; path: string; size: number },
  ): Promise<{ id: string }> {
    const link = await this.requireActiveLink(token);
    try {
      this.assertRateLimit(`${link.id}:${clientIp}`);
      if (link.uploadCount >= MAX_UPLOADS_PER_LINK) {
        throw new BadRequestException('This link has reached its upload limit.');
      }
      const name = uploaderName.trim().slice(0, 80);
      if (name.length === 0) {
        throw new BadRequestException('Please tell us your name first.');
      }
      const typeInfo = classifyMediaFile(file.originalname);
      if (!typeInfo) {
        throw new UnprocessableEntityException('Only photos and videos can be added.');
      }
      const id = uuidv7();
      const stagedPath = this.stagedFilePath(id, file.originalname);
      await rename(file.path, stagedPath);
      try {
        // Decoding the preview IS the validation: a fake ".jpg" fails here.
        await this.thumbnails.renderPreview(stagedPath, typeInfo, this.previewPath(id));
      } catch (error) {
        await rm(stagedPath, { force: true });
        this.logger.warn(
          `Rejected guest upload ${file.originalname}: ${(error as Error).message}`,
        );
        throw new UnprocessableEntityException(
          "That file couldn't be read as a photo or video.",
        );
      }
      await this.db.insert(guestUpload).values({
        id,
        linkId: link.id,
        albumId: link.albumId,
        uploaderName: name,
        originalFilename: file.originalname,
        sizeBytes: file.size,
        mime: typeInfo.mime,
        mediaType: typeInfo.mediaType,
      });
      await this.db
        .update(contributionLink)
        .set({ uploadCount: sql`${contributionLink.uploadCount} + 1` })
        .where(eq(contributionLink.id, link.id));
      // The decode probe above WAS the security review: a validated file goes
      // straight into the album, attributed to the link's creator. If ingest
      // fails, the row stays pending and surfaces in the household review
      // queue instead of being lost.
      try {
        const [row] = await this.db
          .select()
          .from(guestUpload)
          .where(eq(guestUpload.id, id))
          .limit(1);
        await this.approveOne(row, link.createdBy);
      } catch (error) {
        this.logger.error(
          `Auto-ingest of guest upload ${id} (${file.originalname}) failed; left for review: ${(error as Error).message}`,
        );
      }
      return { id };
    } catch (error) {
      // Never leave orphaned temp files behind a failed request.
      await rm(file.path, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Public pool thumbs: the asset must belong to this active link's album. */
  async assertPoolAsset(token: string, assetId: string): Promise<void> {
    const result = await this.db.execute<{ ok: number }>(sql`
      select 1 as ok
      from contribution_link cl
      join album_asset aa on aa.album_id = cl.album_id and aa.asset_id = ${assetId}
      where cl.token = ${token}
        and cl.pool_view = true
        and cl.revoked_at is null
        and cl.expires_at > now()
      limit 1
    `);
    if (result.rows.length === 0) {
      throw new NotFoundException('That photo is not part of this pool.');
    }
  }

  async listUploads(albumId: string, status: string): Promise<GuestUploadView[]> {
    const rows = await this.db
      .select()
      .from(guestUpload)
      .where(and(eq(guestUpload.albumId, albumId), eq(guestUpload.status, status)))
      .orderBy(guestUpload.createdAt);
    return rows.map((row) => ({
      id: row.id,
      uploaderName: row.uploaderName,
      originalFilename: row.originalFilename,
      sizeBytes: row.sizeBytes,
      mediaType: row.mediaType,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** Review-thumb path for the household review UI (pending items only have these). */
  previewPath(uploadId: string): string {
    return join(this.stagingDir, `${uploadId}_preview.webp`);
  }

  /**
   * Approval: the staged file moves into the guest library root and runs the
   * NORMAL ingest pipeline (hash, exif, thumbs, transcode, ML), then joins the
   * album. Only after all of that does the row flip to approved.
   */
  async approve(ids: string[], userId: string): Promise<{ approved: number }> {
    const rows = await this.db
      .select()
      .from(guestUpload)
      .where(and(inArray(guestUpload.id, ids), eq(guestUpload.status, 'pending')));
    if (rows.length === 0) {
      return { approved: 0 };
    }
    let approved = 0;
    for (const row of rows) {
      try {
        await this.approveOne(row, userId);
        approved += 1;
      } catch (error) {
        // One bad file must not block the batch; it stays pending with a log.
        this.logger.error(
          `Approving guest upload ${row.id} (${row.originalFilename}) failed: ${(error as Error).message}`,
        );
      }
    }
    return { approved };
  }

  /** Moves one staged upload into the guest root, ingests it, joins the album. */
  private async approveOne(
    row: typeof guestUpload.$inferSelect,
    userId: string,
  ): Promise<void> {
    const root = await this.ensureGuestRoot();
    const relPath = await this.moveIntoGuestRoot(root.path, row);
    await this.ingest.ingestFile({ rootId: root.id, relPath });
    const assetId = await this.findIngestedAssetId(root.id, relPath);
    await this.albums.addAssets(row.albumId, [assetId], userId);
    await this.db
      .update(guestUpload)
      .set({ status: 'approved', assetId, reviewedBy: userId, reviewedAt: new Date() })
      .where(eq(guestUpload.id, row.id));
    await rm(this.previewPath(row.id), { force: true }).catch(() => undefined);
  }

  /** Rejection deletes the staged bytes immediately; the row stays as audit trail. */
  async reject(ids: string[], userId: string): Promise<{ rejected: number }> {
    const rows = await this.db
      .select()
      .from(guestUpload)
      .where(and(inArray(guestUpload.id, ids), eq(guestUpload.status, 'pending')));
    for (const row of rows) {
      await rm(this.stagedFilePath(row.id, row.originalFilename), { force: true }).catch(
        () => undefined,
      );
      await rm(this.previewPath(row.id), { force: true }).catch(() => undefined);
    }
    if (rows.length > 0) {
      await this.db
        .update(guestUpload)
        .set({ status: 'rejected', reviewedBy: userId, reviewedAt: new Date() })
        .where(
          inArray(
            guestUpload.id,
            rows.map((row) => row.id),
          ),
        );
    }
    return { rejected: rows.length };
  }

  async requireUpload(uploadId: string): Promise<typeof guestUpload.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(guestUpload)
      .where(eq(guestUpload.id, uploadId))
      .limit(1);
    if (!row) {
      throw new NotFoundException('That upload does not exist.');
    }
    return row;
  }

  async ensureStagingDir(): Promise<void> {
    await mkdir(this.stagingDir, { recursive: true });
  }

  private stagedFilePath(uploadId: string, originalFilename: string): string {
    return join(this.stagingDir, `${uploadId}${extname(originalFilename).toLowerCase()}`);
  }

  private assertRateLimit(key: string): void {
    const now = Date.now();
    const recent = (this.recentUploads.get(key) ?? []).filter(
      (at) => now - at < RATE_LIMIT_WINDOW_MS,
    );
    if (recent.length >= RATE_LIMIT_MAX_PER_WINDOW) {
      throw new BadRequestException('Uploading too fast — give it a minute.');
    }
    recent.push(now);
    this.recentUploads.set(key, recent);
  }

  private async requireActiveLink(
    token: string,
  ): Promise<typeof contributionLink.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(contributionLink)
      .where(and(eq(contributionLink.token, token), isNull(contributionLink.revokedAt)))
      .limit(1);
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException('This link is no longer available.');
    }
    return row;
  }

  private async requireAlbum(albumId: string): Promise<void> {
    await this.albums.getDetail(albumId); // Throws NotFound when missing.
  }

  /** The guest library root is created lazily on first approval — no scan enqueued. */
  private async ensureGuestRoot(): Promise<{ id: string; path: string }> {
    await mkdir(this.guestLibraryDir, { recursive: true });
    const [existing] = await this.db
      .select({ id: libraryRoot.id, path: libraryRoot.path })
      .from(libraryRoot)
      .where(eq(libraryRoot.path, this.guestLibraryDir))
      .limit(1);
    if (existing) {
      return existing;
    }
    const [row] = await this.db
      .insert(libraryRoot)
      .values({ id: uuidv7(), path: this.guestLibraryDir, name: 'Guest uploads', excludeGlobs: [] })
      .returning({ id: libraryRoot.id, path: libraryRoot.path });
    return row;
  }

  private async moveIntoGuestRoot(
    rootPath: string,
    row: typeof guestUpload.$inferSelect,
  ): Promise<string> {
    const [albumRow] = await this.db
      .select({ title: album.title })
      .from(album)
      .where(eq(album.id, row.albumId))
      .limit(1);
    const folder = this.toFolderName(albumRow?.title ?? 'Event');
    const fileName = `${row.id.slice(-8)}_${this.toSafeFileName(row.originalFilename)}`;
    const relPath = join(folder, fileName).replaceAll('\\', '/');
    await mkdir(join(rootPath, folder), { recursive: true });
    const stagedPath = this.stagedFilePath(row.id, row.originalFilename);
    await stat(stagedPath); // Surfaces a missing staged file as a clear error.
    await this.moveFile(stagedPath, join(rootPath, folder, fileName));
    return relPath;
  }

  /**
   * rename() with a copy+delete fallback: staging and the guest root can sit
   * on different mounts (EXDEV), and on Windows a just-probed file can still
   * be briefly locked (EBUSY).
   */
  private async moveFile(from: string, to: string): Promise<void> {
    try {
      await rename(from, to);
    } catch {
      await copyFile(from, to);
      await rm(from, { force: true }).catch(() => undefined);
    }
  }

  private async findIngestedAssetId(rootId: string, relPath: string): Promise<string> {
    const [row] = await this.db
      .select({ assetId: assetFile.assetId })
      .from(assetFile)
      .where(and(eq(assetFile.rootId, rootId), eq(assetFile.relPath, relPath)))
      .limit(1);
    if (!row) {
      throw new Error(`Ingest left no asset link for ${relPath}.`);
    }
    return row.assetId;
  }

  private toFolderName(title: string): string {
    const safe = title.replace(/[^\p{L}\p{N} _-]/gu, '').trim();
    return safe.length > 0 ? safe.slice(0, 60) : 'Event';
  }

  private toSafeFileName(original: string): string {
    const safe = original.replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
    return safe.length > 0 ? safe.slice(-100) : 'upload';
  }

  private toLinkView(row: typeof contributionLink.$inferSelect): ContributionLinkView {
    return {
      id: row.id,
      token: row.token,
      poolView: row.poolView,
      expiresAt: row.expiresAt.toISOString(),
      uploadCount: row.uploadCount,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
