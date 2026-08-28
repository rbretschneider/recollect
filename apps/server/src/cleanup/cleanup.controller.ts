import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import { CleanupService, CleanupSuggestions } from './cleanup.service';

/** Body for dismissing suggestions. */
export class DismissRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  assetIds!: string[];
}

/**
 * The cleanup advisor: reclaim NAS space, review-inbox style. Delete grant
 * throughout — every accept path ends in the trash or a replaced original.
 */
@RequireGrant('delete')
@Controller('cleanup')
export class CleanupController {
  constructor(private readonly cleanup: CleanupService) {}

  @Get('suggestions')
  async suggestions(): Promise<CleanupSuggestions> {
    return this.cleanup.getSuggestions();
  }

  @Post('dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(@Body() body: DismissRequestDto, @CurrentUser() user: UserProfile): Promise<void> {
    await this.cleanup.dismiss(body.assetIds, user.id);
  }

  @Post('convert/:assetId')
  @HttpCode(HttpStatus.ACCEPTED)
  async convert(@Param('assetId', ParseUUIDPipe) assetId: string): Promise<{ accepted: true }> {
    await this.cleanup.queueConversion(assetId);
    return { accepted: true };
  }
}
