import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { readdir, stat } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, job, libraryRoot } from '../database/schema';
import { JobQueueService } from '../jobs/job-queue.service';
import { SCAN_ROOT_JOB } from './library-job-types';
import { isFilesystemRoot } from './filesystem-root';
import { isExcludedDirectory } from './scan-classifier';

/** A library root as exposed to the API. */
export interface LibraryRootView {
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  lastScanStartedAt: string | null;
  lastScanCompletedAt: string | null;
}

/** A directory offered by the library folder picker. */
export interface BrowseEntry {
  name: string;
  path: string;
}

/** One level of the folder picker: where we are and what's inside. */
export interface BrowseListing {
  path: string | null;
  entries: BrowseEntry[];
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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

  /**
   * The folder picker: with no path, lists the configured browse bases that
   * exist (the container's mounted volumes); with a path, lists its child
   * directories. Paths outside the bases are refused.
   */
  async browse(path: string | undefined): Promise<BrowseListing> {
    if (!path) {
      const bases: BrowseEntry[] = [];
      for (const base of this.config.libraryBrowseBases) {
        if (await this.isDirectory(base)) {
          bases.push({ name: basename(base) || base, path: base });
        }
      }
      // A single mounted volume needs no "choose a volume" level.
      if (bases.length === 1) {
        return this.browse(bases[0].path);
      }
      return { path: null, entries: bases };
    }
    this.assertWithinBrowseBases(path);
    const entries: BrowseEntry[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory() && !isExcludedDirectory(entry.name, [])) {
        entries.push({ name: entry.name, path: join(path, entry.name).replaceAll('\\', '/') });
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { path, entries };
  }

  private assertWithinBrowseBases(path: string): void {
    const resolved = resolve(path).replaceAll('\\', '/');
    const isInside = this.config.libraryBrowseBases.some((base) => {
      const resolvedBase = resolve(base).replaceAll('\\', '/');
      return resolved === resolvedBase || resolved.startsWith(`${resolvedBase}/`);
    });
    if (!isInside) {
      throw new BadRequestException('That folder is outside the mounted library volumes.');
    }
  }

  private async isDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
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
