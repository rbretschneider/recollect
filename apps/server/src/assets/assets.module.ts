import { AssetCaptionsService } from './asset-captions.service';
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AssetArchiveService } from './asset-archive.service';
import { AssetMediaStreamer } from './asset-media-streamer';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RewriteCaptureDateHandler } from './handlers/rewrite-capture-date.handler';
import { RotateService } from './rotate.service';
import { TranscodeBackfillHandler } from './handlers/transcode-backfill.handler';
import { TranscodePlaybackHandler } from './handlers/transcode-playback.handler';

@Module({
  imports: [MediaModule],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    AssetArchiveService,
    AssetCaptionsService,
    AssetMediaStreamer,
    RotateService,
    RewriteCaptureDateHandler,
    TranscodeBackfillHandler,
    TranscodePlaybackHandler,
  ],
  exports: [AssetsService, AssetArchiveService, AssetMediaStreamer],
})
export class AssetsModule {}
