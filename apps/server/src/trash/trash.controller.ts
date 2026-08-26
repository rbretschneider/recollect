import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import { TrashRequestDto } from './dto/trash-request.dto';
import { TrashItem, TrashService } from './trash.service';

/** Trash endpoints: everything here needs the delete grant (FRD §7). */
@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @RequireGrant('delete')
  @Get()
  async list(): Promise<{ items: TrashItem[] }> {
    return { items: await this.trash.listTrash() };
  }

  @RequireGrant('delete')
  @Post()
  async trashAssets(
    @Body() body: TrashRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ trashed: number }> {
    return this.trash.trashAssets(body.assetIds, user.id);
  }

  @RequireGrant('delete')
  @Post('restore')
  async restore(
    @Body() body: TrashRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ restored: number }> {
    return this.trash.restoreAssets(body.assetIds, user.id);
  }

  /** Empty trash immediately — admin plus delete grant. */
  @RequireAdmin()
  @RequireGrant('delete')
  @Delete()
  @HttpCode(HttpStatus.OK)
  async empty(): Promise<{ purged: number }> {
    return this.trash.purgeExpired(true);
  }
}
