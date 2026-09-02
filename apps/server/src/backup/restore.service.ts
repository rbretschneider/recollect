import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { Client, Pool } from 'pg';
import { promisify } from 'util';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { PG_POOL } from '../database/database.module';
import { BackupService } from './backup.service';

const execFileAsync = promisify(execFile);

/** Tables that must exist in a restored archive before we trust it. */
const REQUIRED_TABLES = ['asset', 'asset_file', 'memory', 'journal_entry', 'person', 'user_account'];

/** How long the API waits before exiting, so the HTTP response gets out. */
const EXIT_DELAY_MS = 1500;

/** Progress of the current/last restore, polled by the Settings page. */
export interface RestoreState {
  status: 'idle' | 'running' | 'failed' | 'swapped';
  step?: string;
  message?: string;
  at?: string;
}

/**
 * Restores a backup **without ever writing into the live database**.
 *
 * The app holds a connection pool to its own database, and Postgres refuses to
 * drop or rename a database that has connections — so restoring in place would
 * mean tearing out tables underneath a running app, with a half-restored
 * database if it fails partway. Instead this restores into a staging database,
 * verifies it, and only then swaps the two by rename. Production is untouched
 * until the final atomic step, and a failure leaves it exactly as it was.
 */
@Injectable()
export class RestoreService {
  private readonly logger = new Logger(RestoreService.name);
  private state: RestoreState = { status: 'idle' };

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly backup: BackupService,
  ) {}

  /**
   * Drops the app's own connections before the swap, so terminating backends
   * can't kill a client out from under us mid-rename.
   */
  private async closeAppPool(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  get isEnabled(): boolean {
    return this.config.restoreEnabled;
  }

  getState(): RestoreState {
    return this.state;
  }

  /**
   * Kicks off a restore. Returns as soon as it's accepted; the work continues
   * in the background and ends with the process exiting so the container
   * restarts onto the restored database.
   */
  start(name: string): void {
    if (!this.isEnabled) {
      throw new BadRequestException(
        'Restore is disabled. Set RESTORE_ENABLED=true on the server to allow it.',
      );
    }
    if (this.state.status === 'running') {
      throw new BadRequestException('A restore is already running.');
    }
    this.state = { status: 'running', step: 'starting', at: new Date().toISOString() };
    void this.run(name);
  }

  private async run(name: string): Promise<void> {
    const names = this.databaseNames();
    let admin: Client | null = null;
    try {
      const dumpPath = await this.backup.pathForBackup(name);
      if (!dumpPath.endsWith('.dump')) {
        throw new Error('Only a .dump archive can be restored (the .json export is a reference copy).');
      }

      admin = new Client({ connectionString: this.maintenanceUrl() });
      await admin.connect();

      // 1. Fresh staging database — production is not touched at all here.
      this.step('preparing a staging database');
      await admin.query(`drop database if exists "${names.staging}"`);
      await admin.query(`create database "${names.staging}"`);

      // 2. Restore into staging. --exit-on-error so a partial archive fails
      //    loudly here, while the live database is still untouched.
      this.step('restoring into staging');
      await execFileAsync(
        'pg_restore',
        ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', this.urlFor(names.staging), dumpPath],
        { maxBuffer: 64 * 1024 * 1024 },
      );

      // 3. Verify before we trust it with anything.
      this.step('verifying the restored data');
      await this.verify(names.staging);

      // 4. Swap. Close our OWN pool first: the terminate below would otherwise
      //    kill our idle clients mid-swap, and a dropped client can take the
      //    process down before the second rename runs — which would leave no
      //    live database at all. We're exiting straight after this anyway.
      this.step('swapping databases');
      await this.closeAppPool();
      await admin.query(`alter database "${names.live}" with allow_connections false`);
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity
         where datname = $1 and pid <> pg_backend_pid()`,
        [names.live],
      );
      await admin.query(`alter database "${names.live}" rename to "${names.retired}"`);
      try {
        await admin.query(`alter database "${names.staging}" rename to "${names.live}"`);
      } catch (error) {
        // Half-swapped is the one truly bad state: no database under the live
        // name. Put the original back before giving up.
        await admin.query(`alter database "${names.retired}" rename to "${names.live}"`);
        await admin.query(`alter database "${names.live}" with allow_connections true`);
        throw error;
      }
      // allow_connections travels with a rename, so the promoted database is
      // still blocked at this point — and the retired copy needs to be
      // reachable to serve as the undo.
      await admin.query(`alter database "${names.live}" with allow_connections true`);
      await admin.query(`alter database "${names.retired}" with allow_connections true`);

      this.state = {
        status: 'swapped',
        step: 'restarting',
        at: new Date().toISOString(),
        message: `Restored. The previous database is kept as "${names.retired}".`,
      };
      this.logger.warn(
        `Restore complete from ${name}. Previous database retained as "${names.retired}". Exiting to reconnect.`,
      );
      await admin.end().catch(() => undefined);
      admin = null;

      // 5. Our pool now points at a renamed database — exit and let the
      //    container's restart policy bring us back onto the restored one.
      setTimeout(() => process.exit(0), EXIT_DELAY_MS);
    } catch (error) {
      const message = (error as Error).message.slice(0, 600);
      this.state = { status: 'failed', message, at: new Date().toISOString() };
      this.logger.error(`Restore failed (live database untouched): ${message}`);
      // Best-effort cleanup of the staging database; production is unaffected.
      try {
        await admin?.query(`drop database if exists "${this.databaseNames().staging}"`);
      } catch {
        // Leave it for an operator to inspect.
      }
    } finally {
      await admin?.end().catch(() => undefined);
    }
  }

  /** A restored archive must actually contain the schema we expect. */
  private async verify(database: string): Promise<void> {
    const client = new Client({ connectionString: this.urlFor(database) });
    await client.connect();
    try {
      for (const table of REQUIRED_TABLES) {
        const result = await client.query<{ present: string | null }>(
          `select to_regclass($1) as present`,
          [`public.${table}`],
        );
        if (!result.rows[0]?.present) {
          throw new Error(`Restored archive is missing the "${table}" table — not swapping it in.`);
        }
      }
      const users = await client.query<{ count: string }>('select count(*)::text from user_account');
      if (Number(users.rows[0]?.count ?? '0') === 0) {
        throw new Error('Restored archive has no user accounts — refusing to swap in a locked-out database.');
      }
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private step(step: string): void {
    this.state = { ...this.state, status: 'running', step };
    this.logger.log(`Restore: ${step}…`);
  }

  /** live / staging / retired database names, derived from DATABASE_URL. */
  private databaseNames(): { live: string; staging: string; retired: string } {
    const live = decodeURIComponent(new URL(this.config.databaseUrl).pathname.replace(/^\//, ''));
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    return { live, staging: `${live}_restore`, retired: `${live}_old_${stamp}` };
  }

  /** The same server, but connected to `postgres` so we can rename databases. */
  private maintenanceUrl(): string {
    return this.urlFor('postgres');
  }

  private urlFor(database: string): string {
    const url = new URL(this.config.databaseUrl);
    url.pathname = `/${database}`;
    return url.toString();
  }
}
