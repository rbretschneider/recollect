import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { RequireGrant } from '../auth/decorators/require-grant.decorator';
import { RenamePersonRequestDto } from './dto/rename-person-request.dto';
import { PeopleService, PersonSummary } from './people.service';

/** People detected by face clustering. */
@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  async list(): Promise<{ people: PersonSummary[] }> {
    return { people: await this.people.list() };
  }

  @Get(':id/assets')
  async assets(@Param('id', ParseUUIDPipe) id: string): Promise<{ assetIds: string[] }> {
    return { assetIds: await this.people.getAssets(id) };
  }

  @RequireGrant('write')
  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenamePersonRequestDto,
  ): Promise<void> {
    await this.people.rename(id, body.name);
  }
}
