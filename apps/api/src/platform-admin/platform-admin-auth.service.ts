import { randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '../common/enums/error-code.enum';
import { hashPassword, verifyPassword } from '../common/utils/password.util';
import { platformAdminConfig } from '../config/platform-admin.config';
import { PrismaService } from '../prisma/prisma.service';
import type { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';

export interface PlatformAdminSession {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  admin: { id: string; email: string };
}

/**
 * Authenticates the `PlatformAdmin` table - a separate identity from tenant
 * `User` rows, with no self-registration, no refresh tokens, and its own
 * JWT secret. See `platform-admin-auth.guard.ts` for why the two identities
 * can never authenticate each other's routes.
 */
@Injectable()
export class PlatformAdminAuthService implements OnModuleInit {
  /** Same enumeration-timing defence as `AuthService`: hashed once at
   * startup so an unknown email costs the same as a real one. */
  private decoyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(platformAdminConfig.KEY) private readonly config: ConfigType<typeof platformAdminConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.decoyHash = await hashPassword(randomBytes(32).toString('hex'));
  }

  async login(dto: PlatformAdminLoginDto): Promise<PlatformAdminSession> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: dto.email }, select: { id: true, email: true, passwordHash: true } });

    const passwordMatches = await verifyPassword(admin?.passwordHash ?? this.decoyHash, dto.password);

    if (admin === null || !passwordMatches) {
      throw new UnauthorizedException({ code: ErrorCode.UNAUTHORIZED, message: 'Invalid email or password' });
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: admin.id, email: admin.email, kind: 'platform_admin' },
      { secret: this.config.jwtSecret, expiresIn: this.config.jwtExpiresInSeconds },
    );

    return { accessToken, expiresIn: this.config.jwtExpiresInSeconds, tokenType: 'Bearer', admin: { id: admin.id, email: admin.email } };
  }
}
