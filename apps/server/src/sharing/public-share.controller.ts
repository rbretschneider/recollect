import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AssetsService } from '../assets/assets.service';
import { Public } from '../auth/decorators/public.decorator';
import { isThumbnailSize } from '../media/thumbnail-store';
import { SharedView, SharingService } from './sharing.service';

/**
 * Public, unauthenticated endpoints behind a share token. Media access is
 * limited to assets that belong to the shared memory/album.
 */
@Controller('share')
export class PublicShareController {
  constructor(
    private readonly sharing: SharingService,
    private readonly assets: AssetsService,
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
    if (!isThumbnailSize(size)) {
      throw new BadRequestException('Unsupported thumbnail size.');
    }
    await this.sharing.assertAssetShared(token, assetId);
    const path = await this.assets.getThumbnailPath(assetId, size);
    res.type('image/webp');
    res.sendFile(path);
  }

  @Public()
  @Get(':token/assets/:assetId/original')
  async original(
    @Param('token') token: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.sharing.assertAssetShared(token, assetId);
    const file = await this.assets.getOriginalFile(assetId);
    res.type(file.mime);
    res.sendFile(file.path);
  }
}
