import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';

/** One past year's photos for today's date. */
export interface OnThisDayYear {
  year: number;
  assetIds: string[];
}

/** Home-page data: "on this day" through the years. */
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Every photo taken on this calendar day (MM-DD, the client's local date —
   * the server must not decide what "today" means for a phone abroad),
   * grouped by year, newest year first.
   */
  @Get('on-this-day')
  async onThisDay(@Query('day') day: string): Promise<{ years: OnThisDayYear[] }> {
    if (!/^\d{2}-\d{2}$/.test(day ?? '')) {
      throw new BadRequestException('day must be MM-DD.');
    }
    const result = await this.db.execute<{ id: string; year: number }>(sql`
      select id, extract(year from captured_day)::int as year
      from asset
      where status = 'active' and to_char(captured_day, 'MM-DD') = ${day}
      order by captured_day desc, captured_at asc
      limit 400
    `);
    const byYear = new Map<number, string[]>();
    for (const row of result.rows) {
      const list = byYear.get(row.year) ?? [];
      list.push(row.id);
      byYear.set(row.year, list);
    }
    return {
      years: [...byYear.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([year, assetIds]) => ({ year, assetIds })),
    };
  }
}
