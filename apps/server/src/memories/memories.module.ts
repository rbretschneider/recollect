import { Module } from '@nestjs/common';
import { EventDetectionService } from './event-detection.service';
import { DetectEventsHandler } from './handlers/detect-events.handler';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { MemoriesController } from './memories.controller';
import { MemoriesService } from './memories.service';

@Module({
  controllers: [InboxController, MemoriesController],
  providers: [EventDetectionService, DetectEventsHandler, InboxService, MemoriesService],
  exports: [MemoriesService],
})
export class MemoriesModule {}
