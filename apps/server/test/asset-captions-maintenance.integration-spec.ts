import { createHash, randomUUID } from 'crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { AssetCaptionsService } from '../src/assets/asset-captions.service';
import {
  asset,
  assetFile,
  libraryRoot,
  userAccount,
} from '../src/database/schema';
import { IngestService } from '../src/library/ingest.service';
import { ThumbnailStore } from '../src/media/thumbnail-store';
import { TrashService } from '../src/trash/trash.service';
import { captionDatabase, image } from './caption-database';

describe('caption maintenance persistence', () => {
  let fixture: Awaited<ReturnType<typeof captionDatabase>>;
  let directory: string;
  beforeAll(async () => {
    fixture = await captionDatabase();
    directory = await mkdtemp(join(tmpdir(), 'caption-library-'));
  });
  afterAll(async () => {
    await fixture?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('reuses logical identity through ingest, duplicate locations, reprocessing, trash and restore', async () => {
    const db = fixture.db,
      id = await image(db),
      root = randomUUID(),
      user = randomUUID();
    const content = Buffer.from('isolated image fixture');
    await db
      .update(asset)
      .set({
        contentHash: createHash('sha256').update(content).digest('hex'),
        title: 'Keep title',
        stageThumbsAt: new Date(),
        motionPhoto: true,
      })
      .where(eq(asset.id, id));
    await db
      .insert(libraryRoot)
      .values({ id: root, name: 'Fixture', path: directory });
    await db
      .insert(userAccount)
      .values({
        id: user,
        email: 'maintenance@example.test',
        displayName: 'Member',
        passwordHash: 'unused',
      });
    await writeFile(join(directory, 'original.jpg'), content);
    const extractor = {
      extract: async () => ({ width: 640, height: 480, raw: {} }),
    };
    const thumbnails = {
      generateAll: async () => ({ width: 640, height: 480 }),
    };
    const queue = { enqueue: async () => {} };
    const motion = {
      extractIfPresent: async () => true,
      removeMotion: async () => {},
    };
    const ingest = new IngestService(
      db,
      extractor as never,
      thumbnails as never,
      queue as never,
      { isEnabled: false } as never,
      motion as never,
    );
    const captions = new AssetCaptionsService(db);
    const entry = await captions.create(id, { text: 'Survives maintenance' });
    await ingest.ingestFile({ rootId: root, relPath: 'original.jpg' });
    await rename(join(directory, 'original.jpg'), join(directory, 'moved.jpg'));
    await db
      .update(assetFile)
      .set({ state: 'missing' })
      .where(eq(assetFile.assetId, id));
    await ingest.ingestFile({ rootId: root, relPath: 'moved.jpg' });
    await writeFile(join(directory, 'duplicate.jpg'), content);
    await ingest.ingestFile({ rootId: root, relPath: 'duplicate.jpg' });
    const locations = await db
      .select()
      .from(assetFile)
      .where(eq(assetFile.assetId, id));
    expect(locations).toHaveLength(3);
    expect(new Set(locations.map((f) => f.assetId))).toEqual(new Set([id]));
    await ingest.reprocessAsset(id);
    expect(await captions.list(id)).toEqual([entry]);
    expect(
      (await db.select().from(asset).where(eq(asset.id, id)))[0],
    ).toMatchObject({ title: 'Keep title', motionPhoto: true });
    const config = { appDataDir: directory, trashRetentionDays: 30 };
    const trash = new TrashService(
      db,
      config as never,
      new ThumbnailStore(config as never),
    );
    expect(await trash.trashAssets([id], user)).toEqual({ trashed: 1 });
    expect(await captions.list(id)).toEqual([entry]);
    expect(await trash.restoreAssets([id], user)).toEqual({ restored: 1 });
    expect(await readFile(join(directory, 'moved.jpg'))).toEqual(content);
    expect(await captions.list(id)).toEqual([entry]);
    await trash.trashAssets([id], user);
    await db
      .update(asset)
      .set({ trashedAt: new Date('2000-01-01') })
      .where(eq(asset.id, id));
    expect(await trash.purgeExpired()).toEqual({ purged: 1 });
    await expect(captions.list(id)).rejects.toMatchObject({ status: 404 });
  });
});
