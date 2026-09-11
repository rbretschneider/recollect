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
/** Lease renewal while a job runs; well inside the 10-minute lease. */
const HEARTBEAT_MS = 2 * 60 * 1000;

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
      await this.execute(claimed, workerId);
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

  private async execute(claimed: ClaimedJob, workerId: string): Promise<void> {
    const handler = this.registry.find(claimed.type);
    if (!handler) {
      await this.queue.fail(
        { ...claimed, attempts: claimed.maxAttempts },
        new Error(`No handler registered for job type '${claimed.type}'.`),
      );
      return;
    }
    // Keep the lease alive for as long as the handler runs. Without this, any
    // job slower than one lease was re-claimed by another worker and run a
    // second time, concurrently, on the same input and output.
    const pulse = setInterval(() => {
      void this.queue.heartbeat(claimed.id, workerId).then((held) => {
        if (!held) {
          this.logger.error(
            `Job ${claimed.type}/${claimed.id}: lease lost while running - another worker may have taken it.`,
          );
        }
      }).catch((error: Error) => {
        this.logger.warn(`Job ${claimed.type}/${claimed.id}: heartbeat failed: ${error.message}`);
      });
    }, HEARTBEAT_MS);
    try {
      await handler.handle(claimed.payload);
      await this.queue.complete(claimed.id);
    } catch (error) {
      this.logger.warn(`Job ${claimed.type}/${claimed.id} failed: ${(error as Error).message}`);
      await this.queue.fail(claimed, error as Error);
    } finally {
      clearInterval(pulse);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
