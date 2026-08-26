import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { TranscodePlaybackHandler } from './handlers/transcode-playback.handler';

@Module({
  imports: [MediaModule],
  controllers: [AssetsController],
  providers: [AssetsService, TranscodePlaybackHandler],
  exports: [AssetsService],
})
export class AssetsModule {}
