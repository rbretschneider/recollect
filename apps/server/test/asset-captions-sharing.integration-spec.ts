import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { AlbumsService } from '../src/albums/albums.service';
import { AssetCaptionsService } from '../src/assets/asset-captions.service';
import {
  album,
  albumAsset,
  asset,
  memory,
  memoryAsset,
  memoryQuote,
  person,
  shareLink,
  userAccount,
} from '../src/database/schema';
import { MemoriesService } from '../src/memories/memories.service';
import { SharingService } from '../src/sharing/sharing.service';
import { captionDatabase, image } from './caption-database';

describe('caption independence and public projections', () => {
  let fixture: Awaited<ReturnType<typeof captionDatabase>>;
  beforeAll(async () => {
    fixture = await captionDatabase();
  });
  afterAll(async () => {
    await fixture?.close();
  });
  it('keeps photo text and speaker IDs private while preserving existing collection content', async () => {
    const db = fixture.db,
      photo = await image(db),
      user = randomUUID(),
      mem = randomUUID(),
      al = randomUUID(),
      speaker = randomUUID();
    await db
      .insert(userAccount)
      .values({
        id: user,
        email: 'fixture@example.test',
        displayName: 'Member',
        passwordHash: 'unused',
      });
    await db.insert(person).values({ id: speaker, name: 'Private speaker' });
    await db
      .update(asset)
      .set({ title: 'Photo title' })
      .where(eq(asset.id, photo));
    await db
      .insert(memory)
      .values({
        id: mem,
        title: 'An outing',
        startAt: new Date(),
        endAt: new Date(),
        createdBy: user,
      });
    await db
      .insert(album)
      .values({ id: al, title: 'A collection', createdBy: user });
    await db
      .insert(memoryAsset)
      .values({ memoryId: mem, assetId: photo, caption: 'Scrapbook text' });
    await db.insert(albumAsset).values({ albumId: al, assetId: photo });
    await db
      .insert(memoryQuote)
      .values({
        id: randomUUID(),
        memoryId: mem,
        text: 'Memory quote',
        saidBy: 'Family',
        createdBy: user,
      });
    const captions = new AssetCaptionsService(db);
    await captions.create(photo, {
      text: 'Private photo text',
      saidByPersonId: speaker,
    });
    const memories = new MemoriesService(db, {} as never),
      albums = new AlbumsService(db);
    const sharing = new SharingService(db, memories, albums);
    for (const [targetType, targetId] of [
      ['asset', photo],
      ['album', al],
      ['memory', mem],
    ]) {
      const token = randomUUID();
      await db
        .insert(shareLink)
        .values({
          id: randomUUID(),
          token,
          targetType,
          targetId,
          createdBy: user,
          includeJournal: true,
        });
      const view = await sharing.getSharedView(token);
      expect(JSON.stringify(view)).not.toContain('Private photo text');
      expect(JSON.stringify(view)).not.toContain(speaker);
      if (targetType === 'memory') {
        expect(view.captions).toEqual({ [photo]: 'Scrapbook text' });
        expect(view.quotes).toEqual([
          { text: 'Memory quote', saidBy: 'Family' },
        ]);
      } else expect(view.captions).toEqual({});
    }
    expect((await memories.getDetail(mem)).captions[photo]).toBe(
      'Scrapbook text',
    );
    expect(
      (await db.select().from(asset).where(eq(asset.id, photo)))[0].title,
    ).toBe('Photo title');
    await db.delete(memoryAsset).where(eq(memoryAsset.assetId, photo));
    await db.delete(albumAsset).where(eq(albumAsset.assetId, photo));
    expect((await captions.list(photo))[0].text).toBe('Private photo text');
  });
});
