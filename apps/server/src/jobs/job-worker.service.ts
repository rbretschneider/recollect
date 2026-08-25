import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { JobHandlerRegistry } from './job-handler';
import { ClaimedJob, JobQueueService } from './job-queue.service';

const IDLE_POLL_MS = 2000;

/**
 * Hosts a bounded pool of workers that poll the queue and dispatch to the
 * registered {@link JobHandler} for each job type. Concurrency is capped so a
 * night of new photos never makes the app unusable (FRD §2).
 */
@Injectable()
export class JobWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobWorkerService.name);
  private isStopping = false;

  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: JobHandlerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    for (let workerIndex = 0; workerIndex < this.config.workerConcurrency; workerIndex++) {
      void this.runWorkerLoop(`worker-${workerIndex}`);
    }
  }

  onApplicationShutdown(): void {
    this.isStopping = true;
  }

  private async runWorkerLoop(workerId: string): Promise<void> {
    while (!this.isStopping) {
      const claimed = await this.claimSafely(workerId);
      if (!claimed) {
        await this.sleep(IDLE_POLL_MS);
        continue;
      }
      await this.execute(claimed);
    }
  }

  private async claimSafely(workerId: string): Promise<ClaimedJob | null> {
    try {
      return await this.queue.claim(workerId);
    } catch (error) {
      this.logger.error(`Claim failed for ${workerId}: ${(error as Error).message}`);
      await this.sleep(IDLE_POLL_MS);
      return null;
    }
  }

  private async execute(claimed: ClaimedJob): Promise<void> {
    const handler = this.registry.find(claimed.type);
    if (!handler) {
      await this.queue.fail(
        { ...claimed, attempts: claimed.maxAttempts },
        new Error(`No handler registered for job type '${claimed.type}'.`),
      );
      return;
    }
    try {
      await handler.handle(claimed.payload);
      await this.queue.complete(claimed.id);
    } catch (error) {
      this.logger.warn(`Job ${claimed.type}/${claimed.id} failed: ${(error as Error).message}`);
      await this.queue.fail(claimed, error as Error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
