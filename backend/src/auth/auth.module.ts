import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

/**
 * Section 6.3. Registers JwtAuthGuard globally via APP_GUARD, so every route in
 * the application is authenticated unless it carries @Public().
 *
 * Secrets are passed per-signing-call in TokenService rather than configured
 * here, because access tokens and MFA session tokens have different lifetimes.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    TotpService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, PasswordService, TokenService],
})
export class AuthModule {}
