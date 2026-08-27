import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { asset } from '../../database/schema';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobQueueService } from '../../jobs/job-queue.service';
import { GeocodeService } from '../geocode.service';

/** Job type: resolve place names for every ~1km cell that has photos. */
export const GEOCODE_BACKFILL_JOB = 'geocode_backfill';

const GEOCODE_BACKFILL_PRIORITY = 200;

/** Cells per run; Nominatim politeness (1 req/s) makes each run ~40s. */
const BATCH_SIZE = 30;
const REQUEST_SPACING_MS = 1200;

/**
 * Walks every photo grid cell without a cached place name and resolves it via
 * the (rate-limited, cached-forever) geocoder, so timeline cards can show
 * "Topsham, Maine" for old photos too. Self-chaining until no cells remain.
 */
@Injectable()
export class GeocodeBackfillHandler implements JobHandler, OnModuleInit {
  readonly type = GEOCODE_BACKFILL_JOB;
  private readonly logger = new Logger(GeocodeBackfillHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(DATABASE) private readonly db: Database,
    private readonly queue: JobQueueService,
    private readonly geocode: GeocodeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(): Promise<void> {
    const cells = await this.db.execute<{ lat: number; lon: number }>(sql`
      select distinct round(${asset.gpsLat}::numeric, 2)::float8 as lat,
                      round(${asset.gpsLon}::numeric, 2)::float8 as lon
      from ${asset}
      where ${asset.gpsLat} is not null
        and ${asset.status} = 'active'
        and not exists (
          select 1 from geocode_cache g where g.cell_key = ${asset.geocodeCellKey}
        )
      limit ${BATCH_SIZE}
    `);
    for (const cell of cells.rows) {
      await this.geocode.reverse(cell.lat, cell.lon);
      await new Promise((resolvePause) => setTimeout(resolvePause, REQUEST_SPACING_MS));
    }
    this.logger.log(`Geocode backfill resolved ${cells.rows.length} cells.`);
    if (cells.rows.length === BATCH_SIZE) {
      await this.queue.enqueue(
        GEOCODE_BACKFILL_JOB,
        {},
        { dedupeKey: `${GEOCODE_BACKFILL_JOB}:${Date.now()}`, priority: GEOCODE_BACKFILL_PRIORITY },
      );
    }
  }
}
