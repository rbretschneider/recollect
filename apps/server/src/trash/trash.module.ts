import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { JobQueueService } from '../jobs/job-queue.service';
import { MediaModule } from '../media/media.module';
import { PURGE_TRASH_JOB, PurgeTrashHandler } from './handlers/purge-trash.handler';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [MediaModule],
  controllers: [TrashController],
  providers: [TrashService, PurgeTrashHandler],
})
export class TrashModule implements OnApplicationBootstrap {
  constructor(private readonly queue: JobQueueService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.enqueue(PURGE_TRASH_JOB, {}, { dedupeKey: PURGE_TRASH_JOB, priority: 250 });
  }
}
