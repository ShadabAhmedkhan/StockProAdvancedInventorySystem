import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { ErrorCode } from '../common/enums/error-code.enum';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { jwtConfig } from '../config/jwt.config';
import { AuthService, type AuthSession } from './auth.service';
import type { AuthResult, PublicUser } from './dto/auth-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { RefreshTokenContext } from './refresh-token.service';

const ONE_MINUTE_MS = 60_000;

/**
 * Credential endpoints are rate limited far below the global allowance.
 * Five attempts a minute is generous for a human and useless for a
 * password-spraying script.
 */
const LOGIN_RATE_LIMIT = { default: { limit: 5, ttl: ONE_MINUTE_MS } };
const REGISTER_RATE_LIMIT = { default: { limit: 10, ttl: ONE_MINUTE_MS } };
const REFRESH_RATE_LIMIT = { default: { limit: 30, ttl: ONE_MINUTE_MS } };
/** A little more generous than login: a human may retry across a couple of typo'd addresses, still useless for enumeration at scale. */
const FORGOT_PASSWORD_RATE_LIMIT = { default: { limit: 10, ttl: ONE_MINUTE_MS } };
const RESET_PASSWORD_RATE_LIMIT = { default: { limit: 10, ttl: ONE_MINUTE_MS } };

/** Length cap on values copied from request headers into the session record. */
const USER_AGENT_MAX = 255;

@ApiTags('Authentication')
@SkipSubscriptionCheck()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  @Public()
  @Throttle(REGISTER_RATE_LIMIT)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an account',
    description: 'The first account on an empty database becomes the administrator; every later self-registration is created as STAFF.',
  })
  async register(@Body() dto: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthResult> {
    return this.completeSession(await this.authService.register(dto, sessionContext(request)), response);
  }

  @Public()
  @Throttle(LOGIN_RATE_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in and receive an access token plus a refresh cookie' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthResult> {
    return this.completeSession(await this.authService.login(dto, sessionContext(request)), response);
  }

  /**
   * Public because the access token is expected to have expired by the time a
   * client refreshes; the httpOnly cookie is the credential being presented.
   */
  @Public()
  @Throttle(REFRESH_RATE_LIMIT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh cookie and issue a new access token' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthResult> {
    const presented = this.readRefreshCookie(request);

    if (presented === undefined) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired refresh token' });
    }

    try {
      const session = await this.authService.refresh(presented, sessionContext(request));
      return this.completeSession(session, response);
    } catch (error) {
      // The cookie is spent either way; leaving it in the browser guarantees
      // the next attempt fails too and looks like token reuse.
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Public()
  @Throttle(FORGOT_PASSWORD_RATE_LIMIT)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset link',
    description: 'Always responds the same way, whether or not the email belongs to an account, so the endpoint cannot be used to enumerate registered users.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() request: Request): Promise<{ success: true }> {
    await this.authService.forgotPassword(dto, sessionContext(request));
    return { success: true };
  }

  @Public()
  @Throttle(RESET_PASSWORD_RATE_LIMIT)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a reset token, and revoke every existing session' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request): Promise<{ success: true }> {
    await this.authService.resetPassword(dto, sessionContext(request));
    return { success: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ success: true }> {
    await this.authService.logout(this.readRefreshCookie(request), sessionContext(request));
    this.clearRefreshCookie(response);

    return { success: true };
  }

  @ApiBearerAuth('access-token')
  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, read fresh from the database' })
  me(@CurrentUser() caller: AuthenticatedUser): Promise<PublicUser> {
    return this.authService.currentUser(caller);
  }

  private completeSession(session: AuthSession, response: Response): AuthResult {
    response.cookie(this.config.cookie.name, session.refreshToken.token, this.cookieOptions());
    return session.result;
  }

  private readRefreshCookie(request: Request): string | undefined {
    const value: unknown = request.cookies[this.config.cookie.name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  private clearRefreshCookie(response: Response): void {
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    response.clearCookie(this.config.cookie.name, options);
  }

  private cookieOptions(): CookieOptions {
    const { name: _name, maxAgeMs, ...rest } = this.config.cookie;
    return { ...rest, maxAge: maxAgeMs };
  }
}

/** Records where a session was created, for the session list and audit trail. */
function sessionContext(request: Request): RefreshTokenContext {
  const userAgent = request.header('user-agent');

  return {
    ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, USER_AGENT_MAX) }),
    ...(request.ip === undefined ? {} : { ipAddress: request.ip }),
  };
}
