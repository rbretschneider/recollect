import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AssetMediaStreamer } from './asset-media-streamer';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RewriteCaptureDateHandler } from './handlers/rewrite-capture-date.handler';
import { TranscodeBackfillHandler } from './handlers/transcode-backfill.handler';
import { TranscodePlaybackHandler } from './handlers/transcode-playback.handler';

@Module({
  imports: [MediaModule],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    AssetMediaStreamer,
    RewriteCaptureDateHandler,
    TranscodeBackfillHandler,
    TranscodePlaybackHandler,
  ],
  exports: [AssetsService, AssetMediaStreamer],
})
export class AssetsModule {}
