import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { FolderListing, FoldersService, RootEntry } from './folders.service';

/** Filesystem-shaped browsing of the library (read grant via global guards). */
@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  async roots(): Promise<{ roots: RootEntry[] }> {
    return { roots: await this.folders.listRoots() };
  }

  @Get(':rootId')
  async browse(
    @Param('rootId', ParseUUIDPipe) rootId: string,
    @Query('path') path?: string,
  ): Promise<FolderListing> {
    return this.folders.browse(rootId, path ?? '');
  }
}
