import { Injectable } from '@nestjs/common';

/** Contract every background job handler implements; new job types plug in by self-registering. */
export interface JobHandler {
  /** The job type this handler processes, e.g. `scan_root`. */
  readonly type: string;

  /** Executes one job. Throwing marks the job failed (retried up to maxAttempts). */
  handle(payload: unknown): Promise<void>;
}

/**
 * Registry the worker pool dispatches through. Feature modules register their
 * handlers in onModuleInit, so adding a job type never modifies the jobs module.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly handlersByType = new Map<string, JobHandler>();

  register(handler: JobHandler): void {
    if (this.handlersByType.has(handler.type)) {
      throw new Error(`A handler for job type '${handler.type}' is already registered.`);
    }
    this.handlersByType.set(handler.type, handler);
  }

  find(type: string): JobHandler | undefined {
    return this.handlersByType.get(type);
  }
}
