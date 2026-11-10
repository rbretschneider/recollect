import { AlbumsController } from './albums.controller';
import type { AlbumsService } from './albums.service';
import type { AssetArchiveService } from '../assets/asset-archive.service';

describe('AlbumsController.downloadZip', () => {
  it('delegates to the shared archive with a sanitised title', async () => {
    const albums = {
      getDetail: jest.fn(async () => ({ title: 'Trip: 2024/5!', assetIds: ['a', 'b'] })),
    } as unknown as AlbumsService;
    const archive = { streamZip: jest.fn(async () => {}) };
    const controller = new AlbumsController(albums, archive as unknown as AssetArchiveService);
    const res = {} as never;
    await controller.downloadZip('id', res);
    expect(archive.streamZip).toHaveBeenCalledWith(res, 'Trip 20245', ['a', 'b']);
  });
});
