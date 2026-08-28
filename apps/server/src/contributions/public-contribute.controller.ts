import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AssetMediaStreamer } from '../assets/asset-media-streamer';
import { Public } from '../auth/decorators/public.decorator';
import { ContributionUploadGuard } from './contribution-upload.guard';
import { ContributeView, ContributionsService } from './contributions.service';

/** The shape multer hands us after streaming to the staging temp dir. */
interface StagedUploadFile {
  originalname: string;
  path: string;
  size: number;
}

/**
 * Public, unauthenticated endpoints behind a contribution token: the guest
 * upload page. Uploads land in quarantine; media access is limited to the
 * link's own approved pool (and only when pool view is on).
 */
@Controller('contribute')
export class PublicContributeController {
  constructor(
    private readonly contributions: ContributionsService,
    private readonly media: AssetMediaStreamer,
  ) {}

  @Public()
  @Get(':token')
  async view(@Param('token') token: string): Promise<ContributeView> {
    return this.contributions.getContributeView(token);
  }

  @Public()
  @Post(':token/upload')
  @UseGuards(ContributionUploadGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('token') token: string,
    @Body('uploaderName') uploaderName: string,
    @UploadedFile() file: StagedUploadFile | undefined,
    @Req() request: Request,
  ): Promise<{ id: string }> {
    if (!file) {
      throw new BadRequestException('No file arrived.');
    }
    return this.contributions.registerUpload(
      token,
      uploaderName ?? '',
      request.ip ?? 'unknown',
      file,
    );
  }

  @Public()
  @Get(':token/assets/:assetId/thumb/:size')
  @Header('Cache-Control', 'private, max-age=3600')
  async poolThumbnail(
    @Param('token') token: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Param('size', ParseIntPipe) size: number,
    @Res() res: Response,
  ): Promise<void> {
    await this.contributions.assertPoolAsset(token, assetId);
    await this.media.streamThumbnail(res, assetId, size);
  }

  @Public()
  @Get(':token/assets/:assetId/original')
  async poolOriginal(
    @Param('token') token: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.contributions.assertPoolAsset(token, assetId);
    await this.media.streamOriginal(res, assetId);
  }

  @Public()
  @Get(':token/assets/:assetId/playback')
  async poolPlayback(
    @Param('token') token: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.contributions.assertPoolAsset(token, assetId);
    await this.media.streamPlayback(res, assetId);
  }
}
