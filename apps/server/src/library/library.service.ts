import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { stat } from 'fs/promises';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, job, libraryRoot } from '../database/schema';
import { JobQueueService } from '../jobs/job-queue.service';
import { SCAN_ROOT_JOB } from './library-job-types';
import { isFilesystemRoot } from './filesystem-root';

/** A library root as exposed to the API. */
export interface LibraryRootView {
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  lastScanStartedAt: string | null;
  lastScanCompletedAt: string | null;
}

/** Aggregate indexing progress for the status panel. */
export interface LibraryStatus {
  totalAssets: number;
  thumbnailed: number;
  failedStages: number;
  queuedJobs: number;
  runningJobs: number;
}

/** Manages library roots and kicks off scans. */
@Injectable()
export class LibraryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueueService,
  ) {}

  async listRoots(): Promise<LibraryRootView[]> {
    const rows = await this.db.select().from(libraryRoot).orderBy(libraryRoot.createdAt);
    return rows.map((row) => this.toView(row));
  }

  /** Registers a folder to index in place and immediately enqueues its first scan. */
  async createRoot(path: string, name: string, excludeGlobs: string[]): Promise<LibraryRootView> {
    await this.assertDirectoryExists(path);
    const [row] = await this.db
      .insert(libraryRoot)
      .values({ id: uuidv7(), path, name, excludeGlobs })
      .returning();
    await this.enqueueScan(row.id);
    return this.toView(row);
  }

  async enqueueScan(rootId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: libraryRoot.id })
      .from(libraryRoot)
      .where(eq(libraryRoot.id, rootId))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`Library root ${rootId} does not exist.`);
    }
    await this.queue.enqueue(
      SCAN_ROOT_JOB,
      { rootId },
      { dedupeKey: `${SCAN_ROOT_JOB}:${rootId}`, priority: 10 },
    );
  }

  async getStatus(): Promise<LibraryStatus> {
    const [assets] = await this.db
      .select({
        totalAssets: count(),
        thumbnailed: count(sql`case when ${asset.stageThumbsAt} is not null then 1 end`),
        failedStages: count(sql`case when ${asset.stageErrors} is not null then 1 end`),
      })
      .from(asset);
    const [jobs] = await this.db
      .select({
        queuedJobs: count(sql`case when ${job.status} = 'queued' then 1 end`),
        runningJobs: count(sql`case when ${job.status} = 'running' then 1 end`),
      })
      .from(job);
    return { ...assets, ...jobs };
  }

  private async assertDirectoryExists(path: string): Promise<void> {
    if (isFilesystemRoot(path)) {
      throw new BadRequestException(
        'A whole drive cannot be a library root — pick the photos folder itself.',
      );
    }
    try {
      const stats = await stat(path);
      if (!stats.isDirectory()) {
        throw new BadRequestException(`'${path}' is not a directory.`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Cannot access '${path}': ${(error as Error).message}`);
    }
  }

  private toView(row: typeof libraryRoot.$inferSelect): LibraryRootView {
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      enabled: row.enabled,
      lastScanStartedAt: row.lastScanStartedAt?.toISOString() ?? null,
      lastScanCompletedAt: row.lastScanCompletedAt?.toISOString() ?? null,
    };
  }
}
