import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { TimelineAsset } from '../assets/assets.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { UserProfile } from '../users/user.types';
import { PlacesService, PlaceSummary } from './places.service';

/** Photos grouped by where they were taken. */
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  async list(): Promise<{ places: PlaceSummary[] }> {
    return { places: await this.places.list() };
  }

  @Get('assets')
  async assets(
    @CurrentUser() user: UserProfile,
    @Query('label') label?: string,
  ): Promise<{ items: TimelineAsset[] }> {
    if (!label || label.length > 300) {
      throw new BadRequestException('A place label is required.');
    }
    return { items: await this.places.getAssets(label, user.id) };
  }

  /**
   * Same-origin proxy for the map's OpenStreetMap tiles. Serving them from our
   * own origin sidesteps every cross-origin wall (CSP, CORP, ad/DNS blockers,
   * and phones that can't reach the tile CDN directly) — the browser only ever
   * talks to us, and the server fetches the tile. Coordinates are validated so
   * this can only ever fetch a real OSM tile, never act as an open proxy; it's
   * public (unauthenticated) so an expiring session never blanks the map.
   */
  @Public()
  @Get('tiles/:z/:x/:y')
  @Header('Cache-Control', 'public, max-age=604800, immutable')
  async tile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Res() res: Response,
  ): Promise<void> {
    const zoom = Number(z);
    const col = Number(x);
    const row = Number(y);
    const span = 2 ** zoom;
    const validCoord =
      Number.isInteger(zoom) &&
      zoom >= 0 &&
      zoom <= 19 &&
      Number.isInteger(col) &&
      col >= 0 &&
      col < span &&
      Number.isInteger(row) &&
      row >= 0 &&
      row < span;
    if (!validCoord) {
      throw new BadRequestException('Invalid tile coordinate.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const upstream = await fetch(
        `https://tile.openstreetmap.org/${zoom}/${col}/${row}.png`,
        {
          headers: { 'User-Agent': 'Recollect/1.0 (self-hosted household photo app)' },
          signal: controller.signal,
        },
      );
      if (!upstream.ok) {
        res.status(502).end();
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.type('image/png').send(body);
    } catch {
      res.status(504).end();
    } finally {
      clearTimeout(timeout);
    }
  }
}
