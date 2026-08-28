import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { FaceIdsRequestDto } from './dto/face-ids-request.dto';
import { MergePersonRequestDto } from './dto/merge-person-request.dto';
import { RenamePersonRequestDto } from './dto/rename-person-request.dto';
import { SetCoverFaceRequestDto } from './dto/set-cover-face-request.dto';
import { FaceCropService } from './face-crop.service';
import { PeopleService, PersonFace, PersonSummary } from './people.service';

/** People detected by face clustering. */
@Controller('people')
export class PeopleController {
  constructor(
    private readonly people: PeopleService,
    private readonly crops: FaceCropService,
  ) {}

  @Get()
  async list(): Promise<{ people: PersonSummary[] }> {
    return { people: await this.people.list() };
  }

  @Get(':id/assets')
  async assets(@Param('id', ParseUUIDPipe) id: string): Promise<{ assetIds: string[] }> {
    return { assetIds: await this.people.getAssets(id) };
  }

  @RequireAdmin()
  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenamePersonRequestDto,
  ): Promise<void> {
    await this.people.rename(id, body.name);
  }

  @RequireAdmin()
  @Post(':id/faces/remove')
  async removeFaces(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FaceIdsRequestDto,
  ): Promise<{ removed: number }> {
    return this.people.removeFaces(id, body.faceIds);
  }

  @RequireAdmin()
  @Put(':id/cover-face')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setCoverFace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetCoverFaceRequestDto,
  ): Promise<void> {
    await this.people.setCoverFace(id, body.faceId);
  }

  @Get(':id/faces')
  async faces(@Param('id', ParseUUIDPipe) id: string): Promise<{ faces: PersonFace[] }> {
    return { faces: await this.people.getFaces(id) };
  }

  /** Square face crop for curation UIs; cached after first render. */
  @Get('faces/:faceId/crop')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async faceCrop(
    @Param('faceId', ParseUUIDPipe) faceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const path = await this.crops.getCropPath(faceId);
    res.type('image/webp');
    res.sendFile(path);
  }

  @RequireAdmin()
  @Post(':id/merge-into')
  @HttpCode(HttpStatus.NO_CONTENT)
  async mergeInto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MergePersonRequestDto,
  ): Promise<void> {
    await this.people.mergeInto(id, body.targetPersonId);
  }

  @RequireAdmin()
  @Post(':id/split')
  async split(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FaceIdsRequestDto,
  ): Promise<{ personId: string }> {
    return this.people.split(id, body.faceIds);
  }

  @RequireAdmin()
  @Post('faces/ignore')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ignore(@Body() body: FaceIdsRequestDto): Promise<void> {
    await this.people.ignoreFaces(body.faceIds);
  }

  /** "These are all different people": re-cluster every auto face from scratch. */
  @RequireAdmin()
  @Post(':id/disband')
  async disband(@Param('id', ParseUUIDPipe) id: string): Promise<{ reclustered: number }> {
    return this.people.disband(id);
  }

  @RequireAdmin()
  @Post(':id/hide')
  @HttpCode(HttpStatus.NO_CONTENT)
  async hide(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.people.hide(id);
  }
}
