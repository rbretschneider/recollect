import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { libraryRoot } from '../database/schema';
import { LibraryService } from './library.service';

const CHECK_EVERY_MS = 15 * 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Scheduled rescans (FRD story S2.3): new files dropped onto the NAS appear
 * without user action. Every enabled root is rescanned once per scan interval
 * (default 24h, SCAN_INTERVAL_HOURS); a boot check covers servers that were
 * asleep when the interval elapsed.
 */
@Injectable()
export class ScanSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ScanSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly library: LibraryService,
  ) {}

  onApplicationBootstrap(): void {
    void this.enqueueDueScans();
    this.timer = setInterval(() => void this.enqueueDueScans(), CHECK_EVERY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async enqueueDueScans(): Promise<void> {
    try {
      const cutoff = Date.now() - this.config.scanIntervalHours * MILLISECONDS_PER_HOUR;
      const roots = await this.db
        .select({ id: libraryRoot.id, lastScanStartedAt: libraryRoot.lastScanStartedAt })
        .from(libraryRoot)
        .where(eq(libraryRoot.enabled, true));
      for (const root of roots) {
        const isDue = !root.lastScanStartedAt || root.lastScanStartedAt.getTime() < cutoff;
        if (isDue) {
          await this.library.enqueueScan(root.id);
        }
      }
    } catch (error) {
      this.logger.error(`Scheduled scan check failed: ${(error as Error).message}`);
    }
  }
}
