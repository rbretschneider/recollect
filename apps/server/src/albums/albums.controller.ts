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
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import type { UserProfile } from '../users/user.types';
import { AddAssetsRequestDto } from '../memories/dto/add-assets-request.dto';
import { AlbumDetail, AlbumsService, AlbumSummary } from './albums.service';
import { CreateAlbumRequestDto } from './dto/create-album-request.dto';
import { RenameAlbumRequestDto } from './dto/rename-album-request.dto';

/** Album CRUD. Reading needs read; changing needs the write grant. */
@Controller('albums')
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get()
  async list(): Promise<{ albums: AlbumSummary[] }> {
    return { albums: await this.albums.list() };
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<AlbumDetail> {
    return this.albums.getDetail(id);
  }

  @RequireGrant('write')
  @Post()
  async create(
    @Body() body: CreateAlbumRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<{ albumId: string }> {
    return this.albums.create(user.id, body.title, body.assetIds ?? []);
  }

  @RequireGrant('write')
  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameAlbumRequestDto,
  ): Promise<void> {
    await this.albums.rename(id, body.title);
  }

  @RequireGrant('write')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.albums.softDelete(id);
  }

  @RequireGrant('write')
  @Post(':id/assets')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addAssets(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddAssetsRequestDto,
    @CurrentUser() user: UserProfile,
  ): Promise<void> {
    await this.albums.addAssets(id, body.assetIds, user.id);
  }

  @RequireGrant('write')
  @Delete(':id/assets/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAsset(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ): Promise<void> {
    await this.albums.removeAsset(id, assetId);
  }
}
