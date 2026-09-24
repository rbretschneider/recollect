import { MemoriesService } from './memories.service';
import { PeopleService } from '../people/people.service';

/**
 * Regression cover for collection membership inserts.
 *
 * memory_asset and album_asset are keyed (collection_id, asset_id), so ONE
 * repeated id fails the whole insert. That is exactly what happened: a
 * look-back moment carried the same photo twice (an asset can have several
 * 'present' files when the same photo sits at two paths on the NAS), and
 * "Make a memory" answered with a 500.
 *
 * The root cause is fixed in the dashboard query, but a caller repeating an
 * id means that photo once — it must never take the request down.
 */

/** A pared-down stand-in for the Drizzle handle, capturing what gets inserted. */
function fakeDb() {
  const inserted: { memoryRow?: Record<string, unknown>; assetRows: Array<Record<string, unknown>> } =
    { assetRows: [] };
  let table = 0;
  const tx = {
    insert: () => ({
      values: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        // First insert in create() is the memory itself; the second is members.
        if (table++ === 0) {
          inserted.memoryRow = rows as Record<string, unknown>;
        } else {
          inserted.assetRows = rows as Array<Record<string, unknown>>;
        }
        return Promise.resolve();
      },
    }),
  };
  const db = {
    transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    // resolveSpan's lookup: no rows, so it falls back to "now".
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  };
  return { db, inserted };
}

describe('MemoriesService.create', () => {
  it('keeps a repeated asset id from failing the whole insert', async () => {
    const { db, inserted } = fakeDb();
    const service = new MemoriesService(db as never, {} as PeopleService);

    await service.create('user-1', 'Acadia, 2021', ['a', 'b', 'a', 'c', 'b']);

    expect(inserted.assetRows.map((row) => row.assetId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the first occurrence, so the caller-given order survives', async () => {
    const { db, inserted } = fakeDb();
    const service = new MemoriesService(db as never, {} as PeopleService);

    await service.create('user-1', 'Acadia', ['c', 'a', 'c', 'b']);

    expect(inserted.assetRows.map((row) => row.assetId)).toEqual(['c', 'a', 'b']);
    expect(inserted.assetRows.map((row) => row.sortOrder)).toEqual([0, 1, 2]);
  });

  it('takes its cover from the deduplicated list', async () => {
    const { db, inserted } = fakeDb();
    const service = new MemoriesService(db as never, {} as PeopleService);

    await service.create('user-1', 'Acadia', ['first', 'first', 'second']);

    expect(inserted.memoryRow?.['coverAssetId']).toBe('first');
  });

  it('handles an empty selection without inserting members', async () => {
    const { db, inserted } = fakeDb();
    const service = new MemoriesService(db as never, {} as PeopleService);

    await service.create('user-1', 'Empty', []);

    expect(inserted.assetRows).toEqual([]);
    expect(inserted.memoryRow?.['coverAssetId']).toBeNull();
  });
});
