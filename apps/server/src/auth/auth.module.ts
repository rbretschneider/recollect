import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { GrantsGuard } from './guards/grants.guard';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordResetService } from './password-reset.service';
import { SetupController } from './setup.controller';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({}), UsersModule, MailModule],
  controllers: [SetupController, AuthController],
  providers: [
    AuthService,
    TokenService,
    LoginThrottleService,
    PasswordResetService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: GrantsGuard },
  ],
})
export class AuthModule {}
