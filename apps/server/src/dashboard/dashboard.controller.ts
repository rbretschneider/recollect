import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { DashboardService, OnThisDayMoment } from './dashboard.service';

/** Home-page data: "on this day" through the years. */
@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly dashboard: DashboardService,
  ) {}

  /**
   * "On this day", reimagined as coherent moments rather than a flat pile:
   * existing Memories on this date, place+time clusters of loose photos, and
   * per-person "with them" cards — filtered and ranked. The client sends its
   * own local MM-DD so the server never decides "today" for a phone abroad.
   */
  @Get('on-this-day')
  async onThisDay(
    @Query('day') day: string,
    @Query('year') year?: string,
    @Query('limit') limit?: string,
  ): Promise<{ moments: OnThisDayMoment[] }> {
    if (!/^\d{2}-\d{2}$/.test(day ?? '')) {
      throw new BadRequestException('day must be MM-DD.');
    }
    const nowYear = Number(year) || new Date().getFullYear();
    const cap = Math.min(Math.max(Number(limit) || 4, 1), 12);
    return { moments: await this.dashboard.onThisDayMoments(day, nowYear, cap) };
  }

  /**
   * The newest photos to land in the library, by when they were added (not when
   * they were taken) — so a just-imported batch or a fresh guest upload shows up
   * at the top of the home page.
   */
  @Get('recently-added')
  async recentlyAdded(
    @Query('limit') limit?: string,
  ): Promise<{ items: Array<{ id: string; mediaType: 'image' | 'video' }> }> {
    const parsed = Number(limit ?? '8');
    const count = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 24) : 8;
    const result = await this.db.execute<{ id: string; media_type: 'image' | 'video' }>(sql`
      select id, media_type
      from asset
      where status = 'active'
      order by created_at desc, id desc
      limit ${count}
    `);
    return { items: result.rows.map((row) => ({ id: row.id, mediaType: row.media_type })) };
  }
}
