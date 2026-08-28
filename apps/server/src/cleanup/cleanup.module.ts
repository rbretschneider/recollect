import { Module } from '@nestjs/common';
import { CleanupController } from './cleanup.controller';
import { CleanupService } from './cleanup.service';
import { ConvertVideoHandler } from './convert-video.handler';

@Module({
  controllers: [CleanupController],
  providers: [CleanupService, ConvertVideoHandler],
})
export class CleanupModule {}
