import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import { JobQueueService } from '../jobs/job-queue.service';
import { REPROCESS_ASSET_JOB } from '../library/handlers/reprocess-asset.handler';
import { isThumbnailSize } from '../media/thumbnail-store';
import { AssetsService, TimelinePage } from './assets.service';
import type { AssetDetail } from './assets.service';

/** Read endpoints for the photo timeline and thumbnails. */
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly queue: JobQueueService,
  ) {}

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

  /** Queues a re-run of metadata + thumbnails for one item (user retry). */
  @RequireGrant('write')
  @Post(':id/reprocess')
  @HttpCode(HttpStatus.ACCEPTED)
  async reprocess(@Param('id', ParseUUIDPipe) id: string): Promise<{ accepted: true }> {
    await this.assets.getDetail(id); // 404 for unknown ids before queueing.
    await this.queue.enqueue(
      REPROCESS_ASSET_JOB,
      { assetId: id },
      { dedupeKey: `${REPROCESS_ASSET_JOB}:${id}`, priority: 20 },
    );
    return { accepted: true };
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

  /**
   * Streams a browser-playable rendition: the original when web-safe, a cached
   * H.264 transcode otherwise. 202 while the transcode is still being prepared.
   */
  @Get(':id/playback')
  async playback(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const resolution = await this.assets.getPlayback(id);
    if (resolution.kind === 'preparing') {
      res.status(HttpStatus.ACCEPTED).json({ status: 'preparing' });
      return;
    }
    res.type(resolution.mime);
    res.sendFile(resolution.path);
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
