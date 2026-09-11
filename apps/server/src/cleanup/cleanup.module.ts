import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { CleanupController } from './cleanup.controller';
import { CleanupService } from './cleanup.service';
import { ConvertVideoHandler } from './convert-video.handler';
import { RestoreOriginalHandler } from './restore-original.handler';

@Module({
  imports: [AssetsModule],
  controllers: [CleanupController],
  providers: [CleanupService, ConvertVideoHandler, RestoreOriginalHandler],
})
export class CleanupModule {}
