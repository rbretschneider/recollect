import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import {
  ContributionLinkView,
  ContributionsService,
  GuestUploadView,
} from './contributions.service';
import { CreateContributionLinkDto, ReviewUploadsDto } from './dto/contribution-request.dto';

/** Household-side management of guest contributions: links + the review queue. */
@Controller('contributions')
export class ContributionsController {
  constructor(private readonly contributions: ContributionsService) {}

  @RequireGrant('write')
  @Post('albums/:albumId/links')
  async createLink(
    @Param('albumId', ParseUUIDPipe) albumId: string,
    @Body() body: CreateContributionLinkDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ link: ContributionLinkView }> {
    const link = await this.contributions.createLink(
      albumId,
      user.id,
      body.poolView ?? true,
      body.expiresInHours ?? 24 * 7,
    );
    return { link };
  }

  @RequireGrant('write')
  @Get('albums/:albumId/links')
  async listLinks(
    @Param('albumId', ParseUUIDPipe) albumId: string,
  ): Promise<{ links: ContributionLinkView[] }> {
    return { links: await this.contributions.listLinksFor(albumId) };
  }

  @RequireGrant('write')
  @Delete('links/:id')
  async revoke(@Param('id', ParseUUIDPipe) linkId: string): Promise<{ ok: true }> {
    await this.contributions.revoke(linkId);
    return { ok: true };
  }

  @RequireGrant('write')
  @Get('albums/:albumId/uploads')
  async listPending(
    @Param('albumId', ParseUUIDPipe) albumId: string,
  ): Promise<{ uploads: GuestUploadView[] }> {
    return { uploads: await this.contributions.listUploads(albumId, 'pending') };
  }

  @RequireGrant('write')
  @Post('uploads/approve')
  async approve(
    @Body() body: ReviewUploadsDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ approved: number }> {
    return this.contributions.approve(body.ids, user.id);
  }

  @RequireGrant('write')
  @Post('uploads/reject')
  async reject(
    @Body() body: ReviewUploadsDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ rejected: number }> {
    return this.contributions.reject(body.ids, user.id);
  }

  /** Review thumbnail for one pending upload (generated at upload time). */
  @RequireGrant('write')
  @Get('uploads/:id/preview')
  async preview(
    @Param('id', ParseUUIDPipe) uploadId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.contributions.requireUpload(uploadId);
    res.type('image/webp');
    res.sendFile(this.contributions.previewPath(uploadId));
  }
}
