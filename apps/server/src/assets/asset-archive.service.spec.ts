import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Response } from 'express';
import { AssetArchiveService, uniqueEntryName } from './asset-archive.service';
import type { AssetsService } from './assets.service';

function fakeRes() {
  const res = new PassThrough() as PassThrough & {
    type: jest.Mock;
    setHeader: jest.Mock;
  };
  res.type = jest.fn();
  res.setHeader = jest.fn();
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => res.on('end', () => resolve(Buffer.concat(chunks))));
  return { res: res as unknown as Response, mock: res, done };
}

describe('uniqueEntryName', () => {
  it('keeps unused names and suffixes collisions before the extension', () => {
    const used = new Set<string>();
    expect(uniqueEntryName('a.jpg', used)).toBe('a.jpg');
    expect(uniqueEntryName('a.jpg', used)).toBe('a (2).jpg');
    expect(uniqueEntryName('a.jpg', used)).toBe('a (3).jpg');
    expect(uniqueEntryName('b', used)).toBe('b');
    expect(uniqueEntryName('b', used)).toBe('b (2)');
  });
});

describe('AssetArchiveService.streamZip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const paths: Record<string, string> = {};
  for (const id of ['a', 'b', 'c']) {
    paths[id] = join(dir, id);
    writeFileSync(paths[id], `content-${id}`);
  }
  const names: Record<string, string> = { a: 'same.jpg', b: 'same.jpg', c: 'c.jpg' };
  const assets = {
    getOriginalFile: jest.fn(async (id: string) => {
      if (!paths[id]) throw new Error('missing');
      return { path: paths[id] };
    }),
    getDownloadName: jest.fn(async (id: string) => names[id]),
  } as unknown as AssetsService;
  beforeEach(() => jest.clearAllMocks());
  const service = new AssetArchiveService(assets);

  it('sets headers and zips present files, skipping missing and duplicate ids with unique names', async () => {
    const { res, mock, done } = fakeRes();
    await service.streamZip(res, 'my-zip', ['a', 'b', 'a', 'gone', 'c']);
    const zip = (await done).toString('latin1');
    expect(mock.type).toHaveBeenCalledWith('application/zip');
    expect(mock.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="my-zip.zip"',
    );
    expect(zip.startsWith('PK')).toBe(true);
    expect(zip).toContain('same.jpg');
    expect(zip).toContain('same (2).jpg');
    expect(zip).toContain('c.jpg');
    expect(zip).toContain('content-a');
    expect(zip).toContain('content-b');
    expect(zip).toContain('content-c');
    expect(assets.getOriginalFile).toHaveBeenCalledTimes(4);
  });
});
