import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import type { UserProfile } from '../users/user.types';
import { CleanupService, CleanupSuggestions, ConvertedOriginal } from './cleanup.service';

/** Body for dismissing suggestions. */
export class DismissRequestDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  assetIds!: string[];
}

/** Body for queueing a conversion. */
export class ConvertRequestDto {
  @IsOptional()
  @IsIn(['hevc', 'h264'])
  codec?: 'hevc' | 'h264';
}

/**
 * The cleanup advisor: reclaim NAS space, review-inbox style. ADMIN only —
 * it replaces originals; this is machinery, not organizing.
 */
@RequireAdmin()
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
  async convert(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() body: ConvertRequestDto,
  ): Promise<{ accepted: true }> {
    await this.cleanup.queueConversion(assetId, body.codec ?? 'hevc');
    return { accepted: true };
  }

  /** Originals slated for deletion after conversion — visible, restorable. */
  @Get('converted')
  async converted(): Promise<{ originals: ConvertedOriginal[] }> {
    return { originals: await this.cleanup.listConvertedOriginals() };
  }

  @Post('restore/:assetId')
  @HttpCode(HttpStatus.ACCEPTED)
  async restore(
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<{ accepted: true }> {
    await this.cleanup.queueRestore(assetId);
    return { accepted: true };
  }
}
