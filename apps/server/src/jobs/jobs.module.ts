import { Global, Module } from '@nestjs/common';
import { JobHandlerRegistry } from './job-handler';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker.service';

@Global()
@Module({
  providers: [JobQueueService, JobWorkerService, JobHandlerRegistry],
  exports: [JobQueueService, JobHandlerRegistry],
})
export class JobsModule {}
