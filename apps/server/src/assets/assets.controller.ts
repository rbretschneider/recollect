import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import { JobQueueService } from '../jobs/job-queue.service';
import { REPROCESS_ASSET_JOB } from '../library/handlers/reprocess-asset.handler';
import { AssetMediaStreamer } from './asset-media-streamer';
import { AssetsService, TimelinePage } from './assets.service';
import type { AssetDetail, TimelineAsset } from './assets.service';
import { AssetIdsRequestDto } from './dto/asset-ids-request.dto';
import { SetCapturedAtRequestDto } from './dto/set-captured-at-request.dto';
import { Body } from '@nestjs/common';

/** Read endpoints for the photo timeline and thumbnails. */
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly media: AssetMediaStreamer,
    private readonly queue: JobQueueService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: UserProfile,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('favorites') favorites?: string,
  ): Promise<TimelinePage> {
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException('limit must be a positive integer.');
    }
    return this.assets.listTimeline(cursor, parsedLimit, user.id, favorites === '1');
  }

  /** Batch lookup: one round trip for a whole album/memory viewer list. */
  @Post('items')
  @HttpCode(HttpStatus.OK)
  async items(
    @Body() body: AssetIdsRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ items: TimelineAsset[] }> {
    return { items: await this.assets.getTimelineItems(body.assetIds, user.id) };
  }

  @Get(':id/detail')
  async detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserProfile,
  ): Promise<AssetDetail> {
    return this.assets.getDetail(id, user.id);
  }

  /** Hearts a photo for the signed-in user. Personal — any member may favorite. */
  @Put(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async favorite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserProfile,
  ): Promise<void> {
    await this.assets.setFavorite(user.id, id, true);
  }

  @Delete(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unfavorite(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserProfile,
  ): Promise<void> {
    await this.assets.setFavorite(user.id, id, false);
  }

  /** Correct an item's capture date (write grant). Also rewrites the file's EXIF. */
  @RequireGrant('write')
  @Patch(':id/captured-at')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setCapturedAt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetCapturedAtRequestDto,
  ): Promise<void> {
    const capturedAt = new Date(body.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('capturedAt must be a valid date.');
    }
    await this.assets.setCapturedAt(id, capturedAt, body.tzOffsetMin);
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

  /** Downloads the original under a friendly unique name (date, owner, id). */
  @Get(':id/download')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.assets.getOriginalFile(id);
    const name = await this.assets.getDownloadName(id);
    res.download(file.path, name);
  }

  /** Streams the original file. express sendFile handles Range requests for video. */
  @Get(':id/original')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async original(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.media.streamOriginal(res, id);
  }

  /**
   * Streams a browser-playable rendition: the original when web-safe, a cached
   * H.264 transcode otherwise. 202 while the transcode is still being prepared.
   */
  @Get(':id/playback')
  async playback(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.media.streamPlayback(res, id);
  }

  /** Streams the embedded motion-photo clip (Android/Pixel/Samsung), 404 if none. */
  @Get(':id/motion')
  async motion(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    await this.media.streamMotion(res, id);
  }

  @Get(':id/thumb/:size')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async thumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('size', ParseIntPipe) size: number,
    @Res() res: Response,
  ): Promise<void> {
    await this.media.streamThumbnail(res, id, size);
  }
}
