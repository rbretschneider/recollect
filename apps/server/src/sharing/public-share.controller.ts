import { Controller, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AssetMediaStreamer } from '../assets/asset-media-streamer';
import { Public } from '../auth/decorators/public.decorator';
import { SharedView, SharingService } from './sharing.service';

/**
 * Public, unauthenticated endpoints behind a share token. Media access is
 * limited to assets that belong to the shared memory/album.
 */
@Controller('share')
export class PublicShareController {
  constructor(
    private readonly sharing: SharingService,
    private readonly media: AssetMediaStreamer,
  ) {}

  @Public()
  @Get(':token')
  async view(@Param('token') token: string): Promise<SharedView> {
    return this.sharing.getSharedView(token);
  }

  @Public()
  @Get(':token/assets/:assetId/thumb/:size')
  @Header('Cache-Control', 'private, max-age=3600')
  async thumbnail(
    @Param('token') token: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Param('size', ParseIntPipe) size: number,
    @Res() res: Response,
  ): Promise<void> {
    await this.sharing.assertAssetShared(token, assetId);
    await this.media.streamThumbnail(res, assetId, size);
  }

  @Public()
  @Get(':token/assets/:assetId/original')
  async original(
    @Param('token') token: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.sharing.assertAssetShared(token, assetId);
    await this.media.streamOriginal(res, assetId);
  }

  @Public()
  @Get(':token/assets/:assetId/playback')
  async playback(
    @Param('token') token: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.sharing.assertAssetShared(token, assetId);
    await this.media.streamPlayback(res, assetId);
  }
}
