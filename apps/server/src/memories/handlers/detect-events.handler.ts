import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { EventDetectionService } from '../event-detection.service';

/** Job type: regenerate Memory suggestions from Tier-1 signals. */
export const DETECT_EVENTS_JOB = 'detect_events';

/** Runs event detection as a low-priority background job. */
@Injectable()
export class DetectEventsHandler implements JobHandler, OnModuleInit {
  readonly type = DETECT_EVENTS_JOB;

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly detection: EventDetectionService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(): Promise<void> {
    await this.detection.detectEvents();
  }
}
