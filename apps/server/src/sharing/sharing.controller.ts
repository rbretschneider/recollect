import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import { CreateShareRequestDto } from './dto/create-share-request.dto';
import { ShareLinkView, ShareTargetType, SharingService } from './sharing.service';

/** Bounded default lifetime for a share link when the caller doesn't set one. */
const DEFAULT_SHARE_EXPIRY_HOURS = 90 * 24;

/** Share-link management for signed-in users (write grant). */
@Controller('sharing')
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @RequireGrant('write')
  @Post()
  async create(
    @Body() body: CreateShareRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ link: ShareLinkView }> {
    // Default to a bounded lifetime; only an explicit neverExpires opt-in makes
    // a permanent link. A caller that both opts in and passes hours gets hours.
    const hours =
      body.expiresInHours ?? (body.neverExpires ? null : DEFAULT_SHARE_EXPIRY_HOURS);
    const expiresAt = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000);
    const link = await this.sharing.createLink(
      body.targetType,
      body.targetId,
      user.id,
      body.includeJournal ?? false,
      expiresAt,
    );
    return { link };
  }

  @RequireGrant('write')
  @Get(':targetType/:targetId')
  async listFor(
    @Param('targetType') targetType: string,
    @Param('targetId', ParseUUIDPipe) targetId: string,
  ): Promise<{ links: ShareLinkView[] }> {
    return { links: await this.sharing.listLinksFor(targetType as ShareTargetType, targetId) };
  }

  @RequireGrant('write')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.sharing.revoke(id);
  }
}
