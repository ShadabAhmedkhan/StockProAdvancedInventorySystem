import { randomBytes } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../common/enums/error-code.enum';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { hashPassword, verifyPassword } from '../common/utils/password.util';
import { jwtConfig } from '../config/jwt.config';
import { AuditAction, AuditEntity, UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthResult, PublicUser } from './dto/auth-response.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { RefreshTokenService, type IssuedRefreshToken, type RefreshTokenContext } from './refresh-token.service';

/** Every field of a user that may leave the API. `passwordHash` is not among them. */
const PUBLIC_USER_SELECT = {
  id: true,
  organizationId: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface AuthSession {
  result: AuthResult;
  refreshToken: IssuedRefreshToken;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * A real Argon2 digest of a random value nobody knows, verified against when
   * the email is unknown. Without it a missing account answers in microseconds
   * while a real one costs ~50ms of hashing, and that gap enumerates accounts.
   *
   * It is computed at startup rather than hard-coded so it always carries the
   * current parameters, and therefore always costs exactly what a real
   * verification costs.
   */
  private decoyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly auditService: AuditService,
    @Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.decoyHash = await hashPassword(randomBytes(32).toString('hex'));
  }

  /**
   * Creates a brand-new organization and its first account, and signs that
   * account in as the organization's ADMIN.
   *
   * This is self-serve signup, not an invite: every registration stands up a
   * fresh, empty organization with the registrant as its sole (and therefore
   * first) member. A teammate joins that same organization afterward through
   * an administrator issuing an account via /users, not through this endpoint
   * - a public endpoint must never be able to mint access into an existing
   * organization it doesn't already belong to.
   */
  async register(dto: RegisterDto, context: RefreshTokenContext): Promise<AuthSession> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (existing !== null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(dto.password);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: dto.organizationName, subscriptionStatus: 'TRIALING', trialEndsAt },
        select: { id: true },
      });

      return tx.user.create({
        data: {
          organizationId: organization.id,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          passwordHash,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        },
        select: PUBLIC_USER_SELECT,
      });
    });

    return this.startSession(user, context);
  }

  async login(dto: LoginDto, context: RefreshTokenContext): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...PUBLIC_USER_SELECT, passwordHash: true },
    });

    // Hash even when the account does not exist, so both paths cost the same.
    const passwordMatches = await verifyPassword(user?.passwordHash ?? this.decoyHash, dto.password);

    if (user === null || !passwordMatches) {
      await this.auditService.record({
        userId: null,
        action: AuditAction.LOGIN_FAILED,
        entity: AuditEntity.AUTH,
        metadata: { email: dto.email, reason: 'invalid_credentials' },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        // No actor, but the account itself - and so its org - is still known
        // whenever the email matched and only the password was wrong.
        organizationId: user?.organizationId ?? null,
      });
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid email or password' });
    }

    // Only reachable by someone who already proved the password, so naming the
    // real reason here leaks nothing and saves a support call.
    if (user.status !== UserStatus.ACTIVE) {
      await this.auditService.record({
        userId: user.id,
        action: AuditAction.LOGIN_FAILED,
        entity: AuditEntity.AUTH,
        metadata: { email: dto.email, reason: 'account_not_active' },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        organizationId: user.organizationId,
      });
      throw new ForbiddenException({ code: ErrorCode.FORBIDDEN, message: 'This account is not active. Contact an administrator.' });
    }

    const { passwordHash: _passwordHash, ...publicUser } = user;

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await this.auditService.record({
      userId: user.id,
      action: AuditAction.LOGIN,
      entity: AuditEntity.AUTH,
      metadata: { email: user.email },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      organizationId: user.organizationId,
    });

    return this.startSession(publicUser, context);
  }

  /**
   * Exchanges a refresh token for a new pair.
   *
   * The presented token is consumed whatever happens next, so a token is good
   * for exactly one refresh. Status is re-read here rather than trusted from
   * the old token: this is the point at which a deactivated account loses
   * access, bounded by the access-token lifetime.
   */
  async refresh(presentedToken: string, context: RefreshTokenContext): Promise<AuthSession> {
    const owner = await this.refreshTokens.consume(presentedToken);

    if (owner === null) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired refresh token' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: owner.userId }, select: PUBLIC_USER_SELECT });

    if (user?.status !== UserStatus.ACTIVE) {
      await this.refreshTokens.revokeAllForUser(owner.userId);
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired refresh token' });
    }

    return this.startSession(user, context);
  }

  /** Idempotent: an absent, unknown or already-revoked token is not an error. */
  async logout(presentedToken: string | undefined, context: RefreshTokenContext = {}): Promise<void> {
    if (presentedToken === undefined || presentedToken === '') {
      return;
    }

    const userId = await this.refreshTokens.revoke(presentedToken);

    if (userId !== null) {
      // No AsyncLocalStorage context exists on this public route; the org
      // has to be looked up rather than assumed, so the entry stays visible
      // to that org's own audit log instead of landing with a null one.
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });

      await this.auditService.record({
        userId,
        action: AuditAction.LOGOUT,
        entity: AuditEntity.AUTH,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        organizationId: user?.organizationId ?? null,
      });
    }
  }

  /**
   * The caller's current record, read fresh so a role or status change is
   * visible immediately rather than at the next token refresh.
   */
  async currentUser(caller: AuthenticatedUser): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: caller.id }, select: PUBLIC_USER_SELECT });

    if (user?.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired access token' });
    }

    return user;
  }

  private async startSession(user: PublicUser, context: RefreshTokenContext): Promise<AuthSession> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: user.id, email: user.email, role: user.role, organizationId: user.organizationId },
        { secret: this.config.accessSecret, expiresIn: this.config.accessExpiresInSeconds },
      ),
      this.refreshTokens.issue(user.id, context),
    ]);

    return {
      result: { accessToken, expiresIn: this.config.accessExpiresInSeconds, tokenType: 'Bearer', user },
      refreshToken,
    };
  }
}
