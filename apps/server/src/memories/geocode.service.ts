import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { geocodeCache } from '../database/schema';

/** The address fields Nominatim may return, most-specific first. */
const PLACE_FIELDS = ['village', 'hamlet', 'town', 'city', 'municipality', 'county'] as const;

interface NominatimResponse {
  address?: Partial<Record<(typeof PLACE_FIELDS)[number], string>>;
}

/**
 * Reverse geocoding for memory locations ("Bowdoin", not "44.03, -69.89").
 * One Nominatim call per ~1km grid cell ever — results (including misses) are
 * memoized in the database. Always best-effort: any failure returns null.
 */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Human place name for coordinates, or null when unknown/disabled. */
  async reverse(lat: number, lon: number): Promise<string | null> {
    if (!this.config.geocodeEnabled) {
      return null;
    }
    const cellKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const [cached] = await this.db
      .select()
      .from(geocodeCache)
      .where(eq(geocodeCache.cellKey, cellKey))
      .limit(1);
    if (cached) {
      return cached.label;
    }
    const label = await this.lookup(lat, lon);
    if (label !== undefined) {
      // A resolved miss (null label) is cached too; a network failure is not.
      await this.db
        .insert(geocodeCache)
        .values({ cellKey, label })
        .onConflictDoNothing({ target: geocodeCache.cellKey });
      return label;
    }
    return null;
  }

  /** null = the place has no name; undefined = the lookup itself failed. */
  private async lookup(lat: number, lon: number): Promise<string | null | undefined> {
    try {
      const url =
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
        `&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=12&accept-language=en`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Recollect/0.1 (self-hosted photo app)' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return undefined;
      }
      const body = (await response.json()) as NominatimResponse;
      for (const field of PLACE_FIELDS) {
        const value = body.address?.[field];
        if (value) {
          return value;
        }
      }
      return null;
    } catch (error) {
      this.logger.warn(`Reverse geocode failed: ${(error as Error).message}`);
      return undefined;
    }
  }
}
