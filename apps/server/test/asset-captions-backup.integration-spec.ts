import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { eq } from 'drizzle-orm';
import { AssetCaptionsService } from '../src/assets/asset-captions.service';
import { BackupService } from '../src/backup/backup.service';
import {
  asset,
  assetCaption,
  assetFile,
  libraryRoot,
  person,
} from '../src/database/schema';
import { captionDatabase, image } from './caption-database';

const exec = promisify(execFile);
describe('caption export and database restore', () => {
  let source: Awaited<ReturnType<typeof captionDatabase>>;
  let restored: Awaited<ReturnType<typeof captionDatabase>>;
  beforeAll(async () => {
    source = await captionDatabase();
    restored = await captionDatabase();
  });
  afterAll(async () => {
    await source?.close();
    await restored?.close();
  });
  it('exports a standalone asset once with relative locations, ordered entries and attribution provenance', async () => {
    const id = await image(source.db),
      root = randomUUID(),
      p = randomUUID();
    await source.db
      .insert(libraryRoot)
      .values({ id: root, path: '/private/library', name: 'Family' });
    await source.db.insert(person).values({ id: p, name: 'Alex' });
    await source.db.insert(assetFile).values(
      ['one.jpg', 'two.jpg'].map((relPath) => ({
        id: randomUUID(),
        assetId: id,
        rootId: root,
        relPath,
        fileName: relPath,
        sizeBytes: 100,
        fsMtime: new Date(),
        state: 'trashed',
        originalRelPath: relPath,
      })),
    );
    const service = new AssetCaptionsService(source.db);
    const first = await service.create(id, {
      text: 'standalone',
      saidByPersonId: p,
    });
    const second = await service.create(id, { text: 'more' });
    await source.db
      .update(person)
      .set({ hidden: true })
      .where(eq(person.id, p));
    const backup = new BackupService(source.db, {} as never);
    const exported = JSON.parse(
      JSON.stringify(await backup['exportMemoryLayer']()),
    );
    expect(exported.memories).toEqual([]);
    expect(exported.albums).toEqual([]);
    expect(exported.people).toBeInstanceOf(Array);
    expect(exported.photoCaptions).toHaveLength(1);
    const photo = exported.photoCaptions[0];
    const [savedAsset] = await source.db
      .select()
      .from(asset)
      .where(eq(asset.id, id));
    expect(photo).toMatchObject({
      assetId: id,
      contentHash: savedAsset.contentHash,
    });
    expect(photo.locations.map((l: { relPath: string }) => l.relPath)).toEqual([
      'one.jpg',
      'two.jpg',
    ]);
    expect(photo.locations[0]).toMatchObject({
      rootId: root,
      rootName: 'Family',
      state: 'trashed',
      originalRelPath: 'one.jpg',
    });
    expect(photo.captions.map((c: { id: string }) => c.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(photo.captions[0]).toMatchObject({
      text: 'standalone',
      saidByPersonId: p,
      saidByLabel: 'Alex',
      resolvedSaidByLabel: 'Alex',
    });
    expect(new Date(photo.captions[0].createdAt).toISOString()).toBe(
      first.createdAt,
    );
    expect(new Date(photo.captions[0].updatedAt).toISOString()).toBe(
      first.updatedAt,
    );
    expect(JSON.stringify(exported)).not.toContain('/private/library');
  });

  it('preserves rows and foreign keys through a real custom-format dump and restore', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'caption-restore-'));
    try {
      const dump = join(directory, 'database.dump');
      await exec('pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--file',
        dump,
        source.url,
      ]);
      await exec('pg_restore', [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '--dbname',
        restored.url,
        dump,
      ]);
      const before = await source.db
        .select()
        .from(assetCaption)
        .orderBy(assetCaption.id);
      expect(
        await restored.db.select().from(assetCaption).orderBy(assetCaption.id),
      ).toEqual(before);
      const id = before[0].assetId;
      await restored.db
        .delete(person)
        .where(eq(person.id, before[0].saidByPersonId!));
      expect(
        (
          await restored.db
            .select()
            .from(assetCaption)
            .where(eq(assetCaption.id, before[0].id))
        )[0],
      ).toMatchObject({ saidByPersonId: null, saidByLabel: 'Alex' });
      await restored.db.delete(asset).where(eq(asset.id, id));
      expect(
        await restored.db
          .select()
          .from(assetCaption)
          .where(eq(assetCaption.assetId, id)),
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
