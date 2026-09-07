import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { readdir, stat } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { appSetting, asset, assetFile, job, libraryRoot } from '../database/schema';
import {
  nextOccurrence,
  SCAN_SCHEDULE_KEY,
  ScanSchedule,
} from './scan-schedule';
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

/** One failed file or job with a plain-language reason. */
export interface LibraryFailure {
  name: string;
  reason: string;
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
  /** Files still waiting on ingest, and the size of the batch they belong to. */
  ingestPending: number;
  batchTotal: number;
  /** Live queue breakdown so the Library page can narrate what's happening. */
  byType: Array<{ type: string; queued: number; running: number }>;
}

/**
 * How long one activity snapshot is served to everyone. Shorter than the
 * client's fastest poll, so nobody ever sees a reading go backwards.
 */
const STATUS_CACHE_MS = 1500;

/** Manages library roots and kicks off scans. */
@Injectable()
export class LibraryService {
  private statusCache: { at: number; value: LibraryStatus } | null = null;
  private statusInFlight: Promise<LibraryStatus> | null = null;

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

  /**
   * Unregisters a folder. Files on disk are NEVER touched; the root's file
   * links cascade away and affected assets flip to missing (they come back
   * whole if the folder is re-added and rescanned).
   */
  async removeRoot(rootId: string): Promise<{ affectedAssets: number }> {
    const affected = await this.db
      .select({ assetId: assetFile.assetId })
      .from(assetFile)
      .where(eq(assetFile.rootId, rootId));
    const [deleted] = await this.db
      .delete(libraryRoot)
      .where(eq(libraryRoot.id, rootId))
      .returning({ id: libraryRoot.id });
    if (!deleted) {
      throw new NotFoundException(`Library root ${rootId} does not exist.`);
    }
    const assetIds = [...new Set(affected.map((row) => row.assetId))];
    if (assetIds.length > 0) {
      // Set-based recompute: an asset stays active if ANY present file
      // survives elsewhere; trashed beats missing.
      await this.db.execute(sql`
        update asset a set status = coalesce((
          select case
            when bool_or(f.state = 'present') then 'active'
            when bool_or(f.state = 'trashed') then 'trashed'
            else 'missing'
          end
          from asset_file f where f.asset_id = a.id
        ), 'missing'), updated_at = now()
        where a.id in ${sql.raw(`(${assetIds.map((id) => `'${id}'`).join(',')})`)}
      `);
    }
    return { affectedAssets: assetIds.length };
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

  /**
   * Live activity, as cheaply as it can be had.
   *
   * Every client polls this continuously, so it is the single most-executed
   * query in the app and its cost is multiplied by everyone connected. Two
   * things keep it honest:
   *
   * - **Never aggregate over the whole job table.** The counts used to be
   *   `count(case when status = 'queued' ...)` with no WHERE, which no index
   *   can answer: measured at 72ms of parallel seq scan over 1.3M rows, twenty
   *   times a minute, per client. The same numbers fall out of the `byType`
   *   breakdown, which is already restricted to live rows and uses the partial
   *   claim index. One index scan now serves all of it.
   * - **Share one result across clients.** The numbers are a progress readout,
   *   not a ledger; a second of staleness is invisible, and it collapses a
   *   household of pollers into one query.
   */
  async getStatus(): Promise<LibraryStatus> {
    const now = Date.now();
    if (this.statusCache && now - this.statusCache.at < STATUS_CACHE_MS) {
      return this.statusCache.value;
    }
    // In flight already? Wait on that one rather than starting a second.
    this.statusInFlight ??= this.computeStatus().finally(() => {
      this.statusInFlight = null;
    });
    const value = await this.statusInFlight;
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  private async computeStatus(): Promise<LibraryStatus> {
    const [[assets], [batch], byType] = await Promise.all([
      this.db
        .select({
          totalAssets: count(),
          thumbnailed: count(sql`case when ${asset.stageThumbsAt} is not null then 1 end`),
          failedStages: count(sql`case when ${asset.stageErrors} is not null then 1 end`),
        })
        .from(asset),
      this.db
        .select({ batchTotal: sql<number>`coalesce(sum(${libraryRoot.lastScanEnqueued}), 0)::int` })
        .from(libraryRoot),
      this.db
        .select({
          type: job.type,
          queued: count(sql`case when ${job.status} = 'queued' then 1 end`),
          running: count(sql`case when ${job.status} = 'running' then 1 end`),
        })
        .from(job)
        .where(sql`${job.status} in ('queued', 'running')`)
        .groupBy(job.type)
        .orderBy(sql`count(*) desc`),
    ]);
    // The totals are just the breakdown summed - no second pass over the table.
    let queuedJobs = 0;
    let runningJobs = 0;
    let ingestPending = 0;
    for (const row of byType) {
      queuedJobs += row.queued;
      runningJobs += row.running;
      if (row.type === 'ingest_file') {
        ingestPending += row.queued + row.running;
      }
    }
    return {
      ...assets,
      queuedJobs,
      runningJobs,
      ingestPending,
      batchTotal: batch.batchTotal,
      byType,
    };
  }

  /**
   * Cancels the current indexing pass: queued scan/ingest jobs are dropped
   * (running ones finish their file). A later "Scan now" redoes the sweep —
   * scans are idempotent, so canceling never loses data.
   */
  async cancelScan(): Promise<{ canceled: number }> {
    const rows = await this.db
      .delete(job)
      .where(sql`${job.status} = 'queued' and ${job.type} in ('scan_root', 'ingest_file')`)
      .returning({ id: job.id });
    return { canceled: rows.length };
  }

  /** Generic UI-settings read; null when never set. */
  async getSetting<T>(key: string): Promise<T | null> {
    const [row] = await this.db
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, key))
      .limit(1);
    return (row?.value as T) ?? null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(appSetting)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
  }

  /** The automatic-scan schedule, with when it fires next (server-local time). */
  async getSchedule(): Promise<{
    schedule: ScanSchedule;
    nextRunAt: string | null;
    serverTimeZone: string;
  }> {
    const schedule = (await this.getSetting<ScanSchedule>(SCAN_SCHEDULE_KEY)) ?? {
      mode: 'interval' as const,
      time: '03:00',
      weekday: 0,
    };
    return {
      schedule,
      nextRunAt: nextOccurrence(schedule, new Date())?.toISOString() ?? null,
      serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  async setSchedule(schedule: ScanSchedule): Promise<void> {
    await this.setSetting(SCAN_SCHEDULE_KEY, schedule);
  }

  /** Disables (or re-enables) a root: kept, browsable, but skipped by scans. */
  async setRootEnabled(rootId: string, enabled: boolean): Promise<LibraryRootView> {
    const [row] = await this.db
      .update(libraryRoot)
      .set({ enabled })
      .where(eq(libraryRoot.id, rootId))
      .returning();
    if (!row) {
      throw new NotFoundException(`Library root ${rootId} does not exist.`);
    }
    return this.toView(row);
  }

  /** What went wrong, in human terms: failed processing stages and failed jobs. */
  async listFailures(): Promise<LibraryFailure[]> {
    const stageRows = await this.db
      .select({ id: asset.id, errors: asset.stageErrors, fileName: assetFile.fileName })
      .from(asset)
      .leftJoin(assetFile, eq(assetFile.assetId, asset.id))
      .where(sql`${asset.stageErrors} is not null`)
      .limit(200);
    const jobRows = await this.db
      .select({ type: job.type, error: job.error, payload: job.payload })
      .from(job)
      .where(eq(job.status, 'failed'))
      .limit(200);
    const failures: LibraryFailure[] = stageRows.map((row) => ({
      name: row.fileName ?? row.id,
      reason: Object.entries((row.errors ?? {}) as Record<string, string>)
        .map(([stage, message]) => `${stage}: ${message}`)
        .join('; '),
    }));
    for (const row of jobRows) {
      const payload = row.payload as { relPath?: string; assetId?: string };
      failures.push({
        name: payload.relPath ?? payload.assetId ?? row.type,
        reason: `${row.type} failed: ${row.error ?? 'unknown error'}`,
      });
    }
    return failures;
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
