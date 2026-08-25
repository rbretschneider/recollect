import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { GrantsGuard } from './guards/grants.guard';
import { SetupController } from './setup.controller';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [SetupController, AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: GrantsGuard },
  ],
})
export class AuthModule {}
