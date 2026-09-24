import { AlbumsService } from './albums.service';

/**
 * Regression cover: album_asset is keyed (album_id, asset_id), so a repeated
 * id fails the whole insert. Albums are created from the same look-back
 * moments that produced duplicate ids and 500'd memory creation — "share the
 * whole look-back" materialises one.
 */
function fakeDb() {
  const inserted: { albumRow?: Record<string, unknown>; assetRows: Array<Record<string, unknown>> } =
    { assetRows: [] };
  let table = 0;
  const tx = {
    insert: () => ({
      values: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (table++ === 0) {
          inserted.albumRow = rows as Record<string, unknown>;
        } else {
          inserted.assetRows = rows as Array<Record<string, unknown>>;
        }
        return Promise.resolve();
      },
    }),
  };
  return {
    db: { transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx) },
    inserted,
  };
}

describe('AlbumsService.create', () => {
  it('keeps a repeated asset id from failing the whole insert', async () => {
    const { db, inserted } = fakeDb();
    const service = new AlbumsService(db as never);

    await service.create('user-1', 'Look-back · Sep 23', ['a', 'b', 'a']);

    expect(inserted.assetRows.map((row) => row.assetId)).toEqual(['a', 'b']);
    expect(inserted.assetRows.map((row) => row.sortOrder)).toEqual([0, 1]);
  });

  it('takes its cover from the deduplicated list', async () => {
    const { db, inserted } = fakeDb();
    const service = new AlbumsService(db as never);

    await service.create('user-1', 'Look-back', ['first', 'first']);

    expect(inserted.albumRow?.['coverAssetId']).toBe('first');
  });
});
