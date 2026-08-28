import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { CreateUserRequestDto } from './dto/create-user-request.dto';
import { UpdateUserRequestDto } from './dto/update-user-request.dto';
import { UsersService } from './users.service';
import type { UserProfile } from './user.types';

/** Household member management — admin only (S1.3/S1.4). */
@RequireAdmin()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(): Promise<{ users: Array<UserProfile & { disabled: boolean }> }> {
    return { users: await this.users.listAll() };
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserRequestDto,
    @CurrentUser() actor: UserProfile,
  ): Promise<{ user: UserProfile }> {
    if (id === actor.id && body.isAdmin === false) {
      throw new BadRequestException("You can't remove your own admin access.");
    }
    const user = await this.users.update(id, body);
    if (!user) {
      throw new BadRequestException('That account does not exist.');
    }
    return { user };
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: UserProfile,
  ): Promise<void> {
    if (id === actor.id) {
      throw new BadRequestException("You can't disable your own account.");
    }
    await this.users.setDisabled(id, true);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enable(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.users.setDisabled(id, false);
  }

  @Post()
  async create(@Body() body: CreateUserRequestDto): Promise<{ user: UserProfile }> {
    const existing = await this.users.findByEmailWithHash(body.email);
    if (existing) {
      throw new ConflictException('An account with that email already exists.');
    }
    const user = await this.users.create({
      email: body.email,
      displayName: body.displayName,
      password: body.password,
      permission: body.permission,
      isAdmin: body.isAdmin ?? false,
    });
    return { user };
  }
}
