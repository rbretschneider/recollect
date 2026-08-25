import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { isThumbnailSize } from '../media/thumbnail-store';
import { AssetsService, TimelinePage } from './assets.service';
import type { AssetDetail } from './assets.service';

/** Read endpoints for the photo timeline and thumbnails. */
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  async list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<TimelinePage> {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException('limit must be a positive integer.');
    }
    return this.assets.listTimeline(cursor, parsedLimit);
  }

  @Get(':id/detail')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<AssetDetail> {
    return this.assets.getDetail(id);
  }

  /** Streams the original file. express sendFile handles Range requests for video. */
  @Get(':id/original')
  async original(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.assets.getOriginalFile(id);
    res.type(file.mime);
    res.sendFile(file.path, (error) => {
      if (error && !res.headersSent) {
        res.status(HttpStatus.NOT_FOUND).json({ message: 'The original file is not available.' });
      }
    });
  }

  @Get(':id/thumb/:size')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async thumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('size', ParseIntPipe) size: number,
    @Res() res: Response,
  ): Promise<void> {
    if (!isThumbnailSize(size)) {
      throw new BadRequestException('Unsupported thumbnail size.');
    }
    const path = await this.assets.getThumbnailPath(id, size);
    res.type('image/webp');
    res.sendFile(path);
  }
}
