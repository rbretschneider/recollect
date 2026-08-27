import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import { AddAssetsRequestDto } from './dto/add-assets-request.dto';
import { AddQuoteRequestDto } from './dto/add-quote-request.dto';
import { CreateMemoryRequestDto } from './dto/create-memory-request.dto';
import { UpdateMemoryRequestDto } from './dto/update-memory-request.dto';
import { WriteJournalRequestDto } from './dto/write-journal-request.dto';
import { MemoriesService, MemoryDetail, MemoryQuoteView, MemorySummary } from './memories.service';

/** Memory timeline, detail, editing, and journal writing. */
@Controller('memories')
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  @Get()
  async list(): Promise<{ memories: MemorySummary[] }> {
    return { memories: await this.memories.list() };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<MemoryDetail> {
    return this.memories.getDetail(id);
  }

  @RequireGrant('write')
  @Post()
  async create(
    @Body() body: CreateMemoryRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ memoryId: string }> {
    return this.memories.create(user.id, body.title, body.assetIds);
  }

  @RequireGrant('write')
  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMemoryRequestDto,
  ): Promise<void> {
    await this.memories.update(id, {
      ...body,
      startAt: body.startAt ? new Date(body.startAt) : undefined,
      endAt: body.endAt ? new Date(body.endAt) : undefined,
    });
  }

  @RequireGrant('write')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: UserProfile): Promise<void> {
    await this.memories.softDelete(id, user.id);
  }

  @RequireGrant('write')
  @Post(':id/assets')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addAssets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddAssetsRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<void> {
    await this.memories.addAssets(id, body.assetIds, user.id);
  }

  @RequireGrant('write')
  @Delete(':id/assets/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<void> {
    await this.memories.removeAsset(id, assetId);
  }

  @RequireGrant('write')
  @Post(':id/quotes')
  async addQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddQuoteRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ quote: MemoryQuoteView }> {
    return {
      quote: await this.memories.addQuote(
        id,
        user.id,
        body.text,
        body.saidBy,
        body.saidByPersonId,
      ),
    };
  }

  @RequireGrant('write')
  @Delete(':id/quotes/:quoteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('quoteId', ParseUUIDPipe) quoteId: string,
  ): Promise<void> {
    await this.memories.deleteQuote(id, quoteId);
  }

  @RequireGrant('write')
  @Put(':id/journal')
  @HttpCode(HttpStatus.NO_CONTENT)
  async writeJournal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WriteJournalRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<void> {
    await this.memories.writeJournal(id, user.id, body.bodyMd);
  }
}
