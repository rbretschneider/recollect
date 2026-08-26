import { Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { CreateUserRequestDto } from './dto/create-user-request.dto';
import { UsersService } from './users.service';
import type { UserProfile } from './user.types';

/** Household member management — admin only (S1.3/S1.4). */
@RequireAdmin()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(): Promise<{ users: UserProfile[] }> {
    return { users: await this.users.list() };
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
