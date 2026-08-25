import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import { AcceptSuggestionRequestDto } from './dto/accept-suggestion-request.dto';
import { MergeSuggestionsRequestDto } from './dto/merge-suggestions-request.dto';
import { InboxService, InboxSuggestion } from './inbox.service';

/** The Memory Inbox: browse suggestions, accept/dismiss/merge them. */
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  async list(): Promise<{ suggestions: InboxSuggestion[] }> {
    return { suggestions: await this.inbox.listSuggestions() };
  }

  @Get(':id/assets')
  async assets(@Param('id', ParseUUIDPipe) id: string): Promise<{ assetIds: string[] }> {
    return { assetIds: await this.inbox.getSuggestionAssets(id) };
  }

  @RequireGrant('write')
  @Post(':id/accept')
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcceptSuggestionRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ memoryId: string }> {
    return this.inbox.accept(id, user.id, body.title);
  }

  @RequireGrant('write')
  @Post(':id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.inbox.dismiss(id);
  }

  @RequireGrant('write')
  @Post('merge')
  async merge(
    @Body() body: MergeSuggestionsRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ memoryId: string }> {
    return this.inbox.merge(body.clusterIds, user.id, body.title);
  }
}
