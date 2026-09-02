import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { sql } from 'drizzle-orm';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { promisify } from 'util';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { appSetting } from '../database/schema';

const execFileAsync = promisify(execFile);

/** Job type: run a database backup. */
export const BACKUP_DATABASE_JOB = 'backup_database';

/** Settings-store key holding the backup configuration. */
export const BACKUP_SETTINGS_KEY = 'backup.settings';
/** Settings-store key holding the outcome of the last run. */
export const BACKUP_LAST_RUN_KEY = 'backup.lastRun';

/** When (and where) the database backs itself up. */
export interface BackupSettings {
  /** 'off' | 'daily' | 'weekly' — mirrors the library scan schedule. */
  mode: 'off' | 'daily' | 'weekly';
  /** Local server time, "HH:MM" 24h. */
  time: string;
  /** 0 = Sunday … 6 = Saturday; only meaningful for weekly. */
  weekday: number;
  /** Absolute directory to write backups into; '' uses the configured default. */
  directory: string;
  /** How many backups to keep; older ones are pruned after each run. */
  keep: number;
  /**
   * Include regenerable ML vectors (CLIP embeddings). Off by default — they're
   * the bulk of the dump and re-derive from the photos, while everything a
   * human authored is always included.
   */
  includeMlData: boolean;
}

/** The result of the most recent backup attempt, for the Settings readout. */
export interface BackupLastRun {
  at: string;
  ok: boolean;
  /** Bytes written (the .dump), when successful. */
  sizeBytes?: number;
  message?: string;
}

/** One backup on disk. */
export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
  /** 'dump' restores with pg_restore; 'json' is the portable memories export. */
  kind: 'dump' | 'json';
}

/**
 * A name this service itself produced: `recollect-<ISO stamp>.dump|json`. The
 * stamp comes from toISOString() with `:` and `.` swapped for `-`, so it keeps
 * the `T` separator *and* the trailing `Z` — both must be allowed here, and
 * anything that could walk out of the backup directory must not be.
 */
export function isBackupFileName(name: string): boolean {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return false;
  }
  return /^recollect-[0-9A-Za-z._-]+\.(dump|json)$/.test(name);
}

const DEFAULT_SETTINGS: BackupSettings = {
  mode: 'off',
  time: '03:30',
  weekday: 0,
  directory: '',
  keep: 7,
  includeMlData: false,
};

/**
 * Scheduled database backups. The photos themselves are safe on the NAS, but
 * everything a household *wrote* — memories, journals, quotes, captions, the
 * names on faces — exists only in Postgres. This backs that up on a schedule,
 * in two forms: a pg_dump custom archive (the restore path) and a plain-JSON
 * export of the memory layer (readable forever, with or without this app).
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getSettings(): Promise<BackupSettings> {
    const stored = await this.readSetting<BackupSettings>(BACKUP_SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async setSettings(next: BackupSettings): Promise<BackupSettings> {
    if (next.directory) {
      this.assertAllowedDirectory(next.directory);
    }
    const settings: BackupSettings = {
      ...DEFAULT_SETTINGS,
      ...next,
      keep: Math.min(Math.max(Math.trunc(next.keep) || DEFAULT_SETTINGS.keep, 1), 60),
    };
    await this.writeSetting(BACKUP_SETTINGS_KEY, settings);
    return settings;
  }

  async getLastRun(): Promise<BackupLastRun | null> {
    return this.readSetting<BackupLastRun>(BACKUP_LAST_RUN_KEY);
  }

  /** The directory backups are written to, after settings/env/default fallback. */
  async resolveDirectory(): Promise<string> {
    const settings = await this.getSettings();
    const chosen = settings.directory || this.config.backupDir;
    return chosen ? resolve(chosen) : resolve(join(this.config.appDataDir, 'backups'));
  }

  async listBackups(): Promise<BackupFile[]> {
    const directory = await this.resolveDirectory();
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return []; // Nothing backed up yet.
    }
    const files: BackupFile[] = [];
    for (const name of names) {
      const kind = name.endsWith('.dump') ? 'dump' : name.endsWith('.json') ? 'json' : null;
      if (!kind || !name.startsWith('recollect-')) {
        continue;
      }
      try {
        const info = await stat(join(directory, name));
        files.push({
          name,
          sizeBytes: info.size,
          createdAt: new Date(info.mtimeMs).toISOString(),
          kind,
        });
      } catch {
        // Racing a prune is fine.
      }
    }
    return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Absolute path of one backup, guarded against traversal (for download). */
  async pathForBackup(name: string): Promise<string> {
    if (!isBackupFileName(name)) {
      throw new BadRequestException('Not a backup file.');
    }
    const directory = resolve(await this.resolveDirectory());
    const path = resolve(join(directory, name));
    // Compare against the directory plus a separator: a bare startsWith would
    // also accept a sibling like "/library/Backups-elsewhere/x.dump".
    if (path !== join(directory, name) || !path.startsWith(directory + sep)) {
      throw new BadRequestException('Not a backup file.');
    }
    return path;
  }

  async deleteBackup(name: string): Promise<void> {
    await rm(await this.pathForBackup(name), { force: true });
  }

  /**
   * Runs a backup now: a pg_dump custom archive plus the portable JSON export,
   * then prunes to the retention count. Records the outcome either way.
   */
  async runBackup(): Promise<BackupLastRun> {
    const settings = await this.getSettings();
    const directory = await this.resolveDirectory();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      await mkdir(directory, { recursive: true });
      const dumpPath = join(directory, `recollect-${stamp}.dump`);
      const args = ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpPath];
      // The job queue is transient operational state, never user content, and
      // restoring it actively causes harm: the dump necessarily captures the
      // very backup job that is running it, frozen as 'running', so a restore
      // resurrects that row and the stale-lease reclaim runs the backup again.
      // Queued rows are equally stale by the time anyone restores. It is also
      // the single biggest table (completed history), so dropping it keeps
      // archives far smaller.
      args.push('--exclude-table-data=job');
      if (!settings.includeMlData) {
        // CLIP vectors are the bulk of the archive and re-derive from the photos.
        // Face rows are always kept: they carry the person assignments a human made.
        args.push('--exclude-table-data=asset_embedding');
      }
      args.push(this.config.databaseUrl);
      await execFileAsync('pg_dump', args, { maxBuffer: 32 * 1024 * 1024 });

      // The no-lock-in artifact: the written layer, readable without this app.
      const jsonPath = join(directory, `recollect-${stamp}.json`);
      await writeFile(jsonPath, JSON.stringify(await this.exportMemoryLayer(), null, 2), 'utf8');

      const info = await stat(dumpPath);
      await this.prune(directory, settings.keep);
      const result: BackupLastRun = { at: new Date().toISOString(), ok: true, sizeBytes: info.size };
      await this.writeSetting(BACKUP_LAST_RUN_KEY, result);
      this.logger.log(`Backup written: ${dumpPath} (${info.size} bytes).`);
      return result;
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      const result: BackupLastRun = { at: new Date().toISOString(), ok: false, message };
      await this.writeSetting(BACKUP_LAST_RUN_KEY, result);
      this.logger.error(`Backup failed: ${message}`);
      return result;
    }
  }

  /**
   * Everything the household wrote, as plain JSON. Photos are referenced by
   * content hash + path rather than embedded, so this stays small and still
   * ties back to the originals on the NAS.
   */
  private async exportMemoryLayer(): Promise<Record<string, unknown>> {
    const memories = await this.db.execute(sql`
      select m.id, m.title, m.description, m.start_at, m.end_at, m.location_label,
             m.created_at,
             coalesce((
               select json_agg(json_build_object(
                 'author', u.display_name, 'body', j.body_md, 'createdAt', j.created_at)
                 order by j.created_at)
               from journal_entry j left join user_account u on u.id = j.author_user_id
               where j.memory_id = m.id), '[]'::json) as journal,
             coalesce((
               select json_agg(json_build_object('text', q.text, 'saidBy', q.said_by))
               from memory_quote q where q.memory_id = m.id), '[]'::json) as quotes,
             coalesce((
               select json_agg(json_build_object(
                 'contentHash', a.content_hash, 'relPath', f.rel_path,
                 'caption', ma.caption, 'capturedAt', a.captured_at)
                 order by ma.sort_order)
               from memory_asset ma
               join asset a on a.id = ma.asset_id
               left join asset_file f on f.asset_id = a.id and f.state = 'present'
               where ma.memory_id = m.id), '[]'::json) as photos
      from memory m where m.deleted_at is null order by m.start_at
    `);
    const albums = await this.db.execute(sql`
      select al.id, al.title, al.description, al.created_at,
             coalesce((
               select json_agg(json_build_object(
                 'contentHash', a.content_hash, 'relPath', f.rel_path)
                 order by aa.sort_order)
               from album_asset aa
               join asset a on a.id = aa.asset_id
               left join asset_file f on f.asset_id = a.id and f.state = 'present'
               where aa.album_id = al.id), '[]'::json) as photos
      from album al where al.deleted_at is null order by al.created_at
    `);
    const people = await this.db.execute(sql`
      select p.name, count(f.id)::int as face_count,
             coalesce((
               select json_agg(distinct a.content_hash)
               from face f2 join asset a on a.id = f2.asset_id
               where f2.person_id = p.id and f2.ignored = false), '[]'::json) as photo_hashes
      from person p left join face f on f.person_id = p.id and f.ignored = false
      where p.name is not null and p.merged_into_id is null
      group by p.id, p.name order by p.name
    `);
    return {
      exportedAt: new Date().toISOString(),
      note:
        'Recollect memory-layer export. Photos are referenced by content hash and ' +
        'library-relative path; the originals live in your library, not in this file.',
      memories: memories.rows,
      albums: albums.rows,
      people: people.rows,
    };
  }

  /** Keeps the newest `keep` backups (dump + its JSON count as one). */
  private async prune(directory: string, keep: number): Promise<void> {
    const files = await this.listBackups();
    const stamps = [...new Set(files.map((file) => file.name.replace(/\.(dump|json)$/, '')))];
    for (const stamp of stamps.slice(keep)) {
      for (const extension of ['.dump', '.json']) {
        await rm(join(directory, `${stamp}${extension}`), { force: true }).catch(() => undefined);
      }
      this.logger.log(`Pruned old backup ${stamp}.`);
    }
  }

  /**
   * A backup directory must sit inside a mounted volume the operator already
   * exposed — the same guard the library folder picker uses, so a UI setting
   * can never write outside them. The app-data dir is always allowed.
   */
  private assertAllowedDirectory(path: string): void {
    const resolved = resolve(path).replaceAll('\\', '/');
    const bases = [...this.config.libraryBrowseBases, this.config.appDataDir];
    const allowed = bases.some((base) => {
      const resolvedBase = resolve(base).replaceAll('\\', '/');
      return resolved === resolvedBase || resolved.startsWith(`${resolvedBase}/`);
    });
    if (!allowed) {
      throw new BadRequestException(
        'Pick a folder inside your mounted volumes so backups land somewhere durable.',
      );
    }
  }

  private async readSetting<T>(key: string): Promise<T | null> {
    const [row] = await this.db
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(sql`${appSetting.key} = ${key}`);
    return (row?.value as T | undefined) ?? null;
  }

  private async writeSetting(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(appSetting)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
  }
}
