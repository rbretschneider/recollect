import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/decorators/public.decorator';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';

/** Liveness/readiness probe: verifies the database is reachable. */
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'up' }> {
    await this.db.execute(sql`select 1`);
    return { status: 'ok', database: 'up' };
  }
}
