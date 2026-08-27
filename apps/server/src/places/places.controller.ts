import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { TimelineAsset } from '../assets/assets.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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
}
