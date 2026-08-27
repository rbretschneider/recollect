import { Module } from '@nestjs/common';
import { EventDetectionService } from './event-detection.service';
import { GeocodeService } from './geocode.service';
import { GeocodeBackfillHandler } from './handlers/geocode-backfill.handler';
import { DetectEventsHandler } from './handlers/detect-events.handler';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { MemoriesController } from './memories.controller';
import { MemoriesService } from './memories.service';

@Module({
  controllers: [InboxController, MemoriesController],
  providers: [
    EventDetectionService,
    DetectEventsHandler,
    GeocodeBackfillHandler,
    GeocodeService,
    InboxService,
    MemoriesService,
  ],
  exports: [MemoriesService],
})
export class MemoriesModule {}
