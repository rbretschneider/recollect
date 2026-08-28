import { Controller, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AssetMediaStreamer } from '../assets/asset-media-streamer';
import { Public } from '../auth/decorators/public.decorator';
import { FaceCropService } from '../people/face-crop.service';
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
    private readonly crops: FaceCropService,
  ) {}

  @Public()
  @Get(':token')
  async view(@Param('token') token: string): Promise<SharedView> {
    return this.sharing.getSharedView(token);
  }

  /** Face-crop avatar for the shared memory's "Who was there" — scoped to the
   *  people actually shown on this link, never arbitrary faces. */
  @Public()
  @Get(':token/faces/:faceId/crop')
  @Header('Cache-Control', 'private, max-age=3600')
  async faceCrop(
    @Param('token') token: string,
    @Param('faceId', ParseUUIDPipe) faceId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.sharing.assertSharedFace(token, faceId);
    res.type('image/webp');
    res.sendFile(await this.crops.getCropPath(faceId));
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
