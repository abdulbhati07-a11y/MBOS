import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccessControlModule } from '../access-control/access-control.module';
import { ApiAccessGuard } from '../common/guards/api-access.guard';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

/**
 * Section 6.3. Registers ApiAccessGuard globally via APP_GUARD, so every route in
 * the application runs the full Section 6.2 chain unless it opts out with
 * @Public().
 *
 * ApiAccessGuard is the single global guard; JwtAuthGuard remains a provider and
 * is invoked by it as chain steps 3-4. Registering both globally would run the
 * authentication step twice.
 *
 * Secrets are passed per-signing-call in TokenService rather than configured
 * here, because access tokens and MFA session tokens have different lifetimes.
 */
@Module({
  imports: [JwtModule.register({}), RateLimitModule, AccessControlModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    TotpService,
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: ApiAccessGuard },
  ],
  exports: [AuthService, PasswordService, TokenService],
})
export class AuthModule {}
