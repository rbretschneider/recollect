import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AssetCaptionsService } from '../src/assets/asset-captions.service';
import { asset, assetCaption, person } from '../src/database/schema';
import { PeopleService } from '../src/people/people.service';
import { captionDatabase, image } from './caption-database';

describe('photo captions against PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof captionDatabase>>;
  let captions: AssetCaptionsService;
  let people: PeopleService;
  beforeAll(async () => {
    fixture = await captionDatabase();
    captions = new AssetCaptionsService(fixture.db);
    people = new PeopleService(fixture.db, {} as never);
  });
  afterAll(async () => { await fixture?.close(); });

  it('starts empty, persists per-entry changes and never upserts deleted entries', async () => {
    const id = await image(fixture.db);
    expect(await captions.list(id)).toEqual([]);
    const a = await captions.create(id, { text: '  first\nline  ' });
    const b = await captions.create(id, { text: 'second' });
    expect(a.text).toBe('first\nline');
    const reopened = new AssetCaptionsService(fixture.db);
    const edited = await reopened.update(id, a.id, { text: 'changed' });
    expect(edited.createdAt).toBe(a.createdAt);
    expect((await reopened.list(id)).map((c) => c.text)).toEqual(['changed', 'second']);
    await captions.delete(id, a.id);
    await expect(captions.update(id, a.id, { text: 'resurrection' })).rejects.toBeInstanceOf(NotFoundException);
    expect((await captions.list(id)).map((c) => c.id)).toEqual([b.id]);
  });

  it('serializes concurrent additions at capacity and frees space on deletion', async () => {
    const id = await image(fixture.db);
    for (let n = 0; n < 9; n++) await captions.create(id, { text: String(n) });
    const results = await Promise.allSettled([
      captions.create(id, { text: 'ten' }), new AssetCaptionsService(fixture.db).create(id, { text: 'eleven' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ConflictException);
    expect(failure.reason.getResponse().code).toBe('CAPTION_LIMIT_REACHED');
    const all = await captions.list(id);
    expect(all).toHaveLength(10);
    await captions.delete(id, all[0].id);
    await captions.create(id, { text: 'replacement' });
    expect(await captions.list(id)).toHaveLength(10);
  });

  it('scopes entry identities and rejects invalid targets and text without changes', async () => {
    const id = await image(fixture.db), other = await image(fixture.db), video = await image(fixture.db, 'video');
    const entry = await captions.create(id, { text: 'safe' });
    await expect(captions.update(other, entry.id, { text: 'wrong' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(captions.delete(other, entry.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(captions.create(video, { text: 'wrong' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(captions.create(randomUUID(), { text: 'wrong' })).rejects.toBeInstanceOf(NotFoundException);
    for (const text of ['', ' \n', 'x'.repeat(501), 'a\0b']) {
      await expect(captions.update(id, entry.id, { text })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(captions.create(id, { text: '🌻'.repeat(500) })).resolves.toMatchObject({ text: '🌻'.repeat(500) });
    expect((await captions.list(id))[0].text).toBe('safe');
  });

  it('orders ties by identity, and concurrent edits preserve unrelated entries', async () => {
    const id = await image(fixture.db);
    const a = await captions.create(id, { text: 'A' }), b = await captions.create(id, { text: 'B' });
    await fixture.db.update(assetCaption).set({ createdAt: new Date('2026-01-01') }).where(eq(assetCaption.assetId, id));
    await Promise.all([captions.update(id, a.id, { text: 'AA' }), captions.update(id, b.id, { text: 'BB' })]);
    const all = await captions.list(id);
    expect(all.map((c) => c.id)).toEqual([a.id, b.id].sort());
    expect(all.map((c) => c.text).sort()).toEqual(['AA', 'BB']);
  });

  it('supports named people with no faces and retains labels through person lifecycle', async () => {
    const id = await image(fixture.db), p = randomUUID(), q = randomUUID(), r = randomUUID();
    await fixture.db.insert(person).values([{ id: p, name: 'Alex' }, { id: q }, { id: r, name: 'Sam' }]);
    expect(await people.attributionOptions()).toContainEqual(expect.objectContaining({ id: p, faceCount: 0, coverFaceId: null }));
    const c = await captions.create(id, { text: 'hello', saidByPersonId: p });
    await people.rename(p, 'Taylor');
    expect((await captions.list(id))[0]).toMatchObject({ saidByLabel: 'Taylor', saidByPersonId: p });
    await people.mergeInto(p, q);
    expect((await captions.list(id))[0]).toMatchObject({ saidByLabel: 'Taylor', saidByPersonId: q });
    await people.mergeInto(q, r);
    expect((await captions.list(id))[0]).toMatchObject({ saidByLabel: 'Sam', saidByPersonId: r });
    await people.rename(r, '');
    expect((await captions.list(id))[0]).toMatchObject({ saidByLabel: 'Sam', saidByPersonId: null });
    await captions.update(id, c.id, { text: 'edited orphan' });
    expect((await captions.list(id))[0].saidByLabel).toBe('Sam');
    await people.rename(r, 'Morgan');
    await people.hide(r);
    expect((await captions.list(id))[0]).toMatchObject({ saidByLabel: 'Morgan', saidByPersonId: null });
    await expect(captions.update(id, c.id, { text: 'lost', saidByPersonId: r })).rejects.toBeInstanceOf(BadRequestException);
    expect((await captions.list(id))[0].text).toBe('edited orphan');
    await fixture.db.delete(person).where(eq(person.id, r));
    expect((await captions.list(id))[0]).toMatchObject({ saidByLabel: 'Morgan', saidByPersonId: null });
    await captions.update(id, c.id, { text: 'plain', saidByPersonId: null });
    expect((await captions.list(id))[0]).toMatchObject({ saidByLabel: null, saidByPersonId: null });
  });

  it('validates selections under locks against hide and merge races', async () => {
    const id = await image(fixture.db);
    for (const change of ['hide', 'merge'] as const) {
      const p = randomUUID(), q = randomUUID();
      await fixture.db.insert(person).values([{ id: p, name: 'Visible' }, { id: q, name: 'Survivor' }]);
      const client = await fixture.pool.connect();
      await client.query('begin');
      await client.query('select id from person where id = $1 for update', [p]);
      const saving = captions.create(id, { text: change, saidByPersonId: p });
      if (change === 'hide') await client.query('update person set hidden = true where id = $1', [p]);
      else await client.query('update person set merged_into_id = $2 where id = $1', [p, q]);
      await client.query('commit'); client.release();
      await expect(saving).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await captions.list(id)).toEqual([]);
  });

  it('retains rows through trash, restore and file-independent maintenance; cascades on purge', async () => {
    const id = await image(fixture.db);
    await captions.create(id, { text: 'keep' });
    for (const status of ['trashed', 'active', 'missing', 'active']) {
      await fixture.db.update(asset).set({ status }).where(eq(asset.id, id));
      expect((await captions.list(id))[0].text).toBe('keep');
    }
    await fixture.db.delete(asset).where(eq(asset.id, id));
    const rows = await fixture.db.select().from(assetCaption).where(eq(assetCaption.assetId, id));
    expect(rows).toEqual([]);
  });
});
