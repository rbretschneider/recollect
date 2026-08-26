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
    const link = await this.sharing.createLink(
      body.targetType,
      body.targetId,
      user.id,
      body.includeJournal ?? false,
    );
    return { link };
  }

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
