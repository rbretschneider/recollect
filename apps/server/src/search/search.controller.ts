import { Controller, Get, Query } from '@nestjs/common';
import { SearchResults, SearchService } from './search.service';

/** One search box for the whole library (read grant via global guards). */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async query(@Query('q') q?: string): Promise<SearchResults> {
    return this.search.search(q ?? '');
  }
}
