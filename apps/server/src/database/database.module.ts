import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import * as schema from './schema';

/** The Drizzle database handle typed with the full application schema. */
export type Database = NodePgDatabase<typeof schema>;

/** Injection token for {@link Database}. */
export const DATABASE = Symbol('DATABASE');

/** Injection token for the underlying pg {@link Pool} (raw SQL, e.g. job claiming). */
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        const pool = new Pool({
          connectionString: config.databaseUrl,
          max: 16,
          idleTimeoutMillis: 30_000,
          // Fail fast instead of queueing forever when the pool is exhausted.
          connectionTimeoutMillis: 5_000,
          keepAlive: true,
          statement_timeout: 15_000,
          application_name: 'recollect',
        });
        // An IDLE client that dies takes the whole process with it otherwise:
        // node-postgres emits 'error' on the pool, and an unhandled 'error'
        // event is a hard crash in Node. That happens on any server-side
        // disconnect — a database restart, a failover, an admin terminating
        // backends — none of which should kill the app. The pool discards the
        // broken client and hands out a fresh one on the next query.
        pool.on('error', (error) => {
          new Logger('DatabasePool').warn(`Idle client dropped: ${error.message}`);
        });
        return pool;
      },
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DATABASE, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
