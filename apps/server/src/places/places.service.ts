import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AssetsService, TimelineAsset } from '../assets/assets.service';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';

/** One place (a geocoded label like "Topsham, Maine, United States"). */
export interface PlaceSummary {
  /** Full label; the unique key for a place. */
  label: string;
  /** Short display name (the town — first label segment). */
  town: string;
  gpsLat: number;
  gpsLon: number;
  assetCount: number;
  coverAssetId: string;
}

const PLACE_ASSETS_LIMIT = 2000;

/**
 * The Places view: photos grouped by where they were taken, built from the
 * geocode cache (each ~1km GPS cell resolves to a place label once, ever).
 */
@Injectable()
export class PlacesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly assets: AssetsService,
  ) {}

  /** Every named place with photos, most-photographed first. */
  async list(): Promise<PlaceSummary[]> {
    const result = await this.db.execute<{
      label: string;
      lat: number;
      lon: number;
      asset_count: number;
      cover_asset_id: string;
    }>(sql`
      select g.label,
             avg(a.gps_lat)::float8 as lat,
             avg(a.gps_lon)::float8 as lon,
             count(*)::int as asset_count,
             (array_agg(a.id order by a.captured_at desc))[1] as cover_asset_id
      from asset a
      join geocode_cache g on g.cell_key = a.geocode_cell_key
      where a.status = 'active' and g.label is not null
      group by g.label
      order by count(*) desc
    `);
    return result.rows.map((row) => ({
      label: row.label,
      town: row.label.split(',')[0].trim(),
      gpsLat: row.lat,
      gpsLon: row.lon,
      assetCount: row.asset_count,
      coverAssetId: row.cover_asset_id,
    }));
  }

  /** The photos taken at one place, newest first. */
  async getAssets(label: string, userId: string): Promise<TimelineAsset[]> {
    const result = await this.db.execute<{ id: string }>(sql`
      select a.id
      from asset a
      join geocode_cache g on g.cell_key = a.geocode_cell_key
      where a.status = 'active' and g.label = ${label}
      order by a.captured_at desc
      limit ${PLACE_ASSETS_LIMIT}
    `);
    return this.assets.getTimelineItems(
      result.rows.map((row) => row.id),
      userId,
    );
  }
}
