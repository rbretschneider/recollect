import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { CreateRootRequestDto } from './dto/create-root-request.dto';
import {
  BrowseListing,
  LibraryFailure,
  LibraryRootView,
  LibraryService,
  LibraryStatus,
} from './library.service';

/** Library-root management and indexing status. Roots are admin territory. */
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('roots')
  async listRoots(): Promise<{ roots: LibraryRootView[] }> {
    return { roots: await this.library.listRoots() };
  }

  @RequireAdmin()
  @Post('roots')
  async createRoot(@Body() body: CreateRootRequestDto): Promise<{ root: LibraryRootView }> {
    const root = await this.library.createRoot(body.path, body.name, body.excludeGlobs ?? []);
    return { root };
  }

  @RequireAdmin()
  @Post('roots/:id/scan')
  @HttpCode(HttpStatus.ACCEPTED)
  async scan(@Param('id', ParseUUIDPipe) id: string): Promise<{ accepted: true }> {
    await this.library.enqueueScan(id);
    return { accepted: true };
  }

  @Get('status')
  async status(): Promise<LibraryStatus> {
    return this.library.getStatus();
  }

  /** Folder picker over the mounted library volumes. */
  @RequireAdmin()
  @Get('browse')
  async browse(@Query('path') path?: string): Promise<BrowseListing> {
    return this.library.browse(path);
  }

  /** Plain-language list of what failed and why. */
  @RequireAdmin()
  @Get('failures')
  async failures(): Promise<{ failures: LibraryFailure[] }> {
    return { failures: await this.library.listFailures() };
  }
}
