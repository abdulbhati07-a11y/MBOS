import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { NoModuleRequired } from '../access-control/access-control.decorators';
import { Public } from '../common/decorators/public.decorator';
import { StrictRateLimit } from '../rate-limit/rate-limit.decorator';
import { AuthService, AuthenticatedSession } from './auth.service';
import {
  AccessTokenResponse,
  CurrentUserResponse,
  LoginResponse,
} from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/** Section 6.3 puts the refresh token in a cookie, never in a response body. */
export const REFRESH_COOKIE = 'mbos_refresh_token';

@Controller('auth')
export class AuthController {
  private readonly isProduction: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  @Public()
  @StrictRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const outcome = await this.auth.login(dto);
    if (outcome.kind === 'mfaRequired') {
      return { mfaRequired: true, mfaSessionToken: outcome.mfaSessionToken };
    }
    return this.completeSession(outcome.session, res);
  }

  @Public()
  @StrictRateLimit()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    return this.completeSession(await this.auth.verifyMfa(dto), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    const presented = readRefreshCookie(req);
    const session = await this.auth.refresh(presented ?? '');
    return this.completeSession(session, res);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  /**
   * Section 6.3 forgot-password (DEBT-015). Always 202 — the body and status
   * are identical for a known and an unknown address, so responses cannot be
   * used to enumerate accounts. Strictly rate-limited: this is a mail-sending
   * endpoint reachable without authentication.
   */
  @Public()
  @StrictRateLimit()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.forgotPassword(dto.email);
  }

  /**
   * Section 6.3 reset-password (DEBT-015). 204 on success; an invalid, expired
   * or already-used token is a 401 from the service. Strictly rate-limited so
   * the token cannot be brute-forced through the endpoint.
   */
  @Public()
  @StrictRateLimit()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  /**
   * Authenticated — the only endpoint in 6.3 that is not @Public.
   *
   * @NoModuleRequired because it returns the caller's own identity and role and
   * belongs to no business module. It is also the endpoint the frontend calls to
   * discover what it may do (DEBT-006), so gating it behind a permission would be
   * circular.
   */
  @NoModuleRequired()
  @Get('me')
  async me(): Promise<CurrentUserResponse> {
    return this.auth.currentUser();
  }

  private completeSession(
    session: AuthenticatedSession,
    res: Response,
  ): AccessTokenResponse {
    res.cookie(REFRESH_COOKIE, session.refresh.token, {
      ...this.cookieOptions(),
      expires: session.refresh.expiresAt,
    });
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
    };
  }

  /**
   * `secure` is conditional so the cookie still works over http://localhost in
   * development; everything else matches Section 6.3 verbatim. `path` is scoped
   * to the auth routes because refresh is the only consumer.
   */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.isProduction,
      path: '/api/v1/auth',
    };
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[REFRESH_COOKIE];
}
