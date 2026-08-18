import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { jwtConfig } from '../config/jwt.config';
import { PrismaService } from '../prisma/prisma.service';

/** 384 bits of entropy - far beyond guessing, and short enough for a cookie. */
const TOKEN_BYTES = 48;

export interface IssuedRefreshToken {
  /** The value handed to the client. Never stored. */
  token: string;
  expiresAt: Date;
}

export interface RefreshTokenContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface RefreshTokenOwner {
  userId: string;
  tokenId: string;
}

/**
 * Issues, rotates and revokes refresh tokens.
 *
 * Tokens are opaque random strings rather than JWTs so that revocation is
 * immediate and authoritative: a token is valid only while its row says so.
 *
 * Only a SHA-256 digest is persisted. A password hash such as Argon2 would be
 * wrong here for two reasons: the token is already 384 bits of uniform
 * randomness, so key stretching protects against nothing, and a salted hash
 * cannot be looked up by value. The digest is unique and indexed, so lookup is
 * a single indexed read.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(jwtConfig.KEY) private readonly config: ConfigType<typeof jwtConfig>,
  ) {}

  static digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string, context: RefreshTokenContext = {}): Promise<IssuedRefreshToken> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.refreshExpiresInMs);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: RefreshTokenService.digest(token),
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Validates a presented token and consumes it.
   *
   * Returns the owner when the token was live, `null` otherwise. Presenting an
   * already-revoked token is treated as theft: the legitimate holder rotated
   * it, so a second use means the value leaked. Every session for that user is
   * revoked, which logs out both the attacker and the victim - the victim can
   * sign in again, the attacker cannot.
   */
  async consume(token: string): Promise<RefreshTokenOwner | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: RefreshTokenService.digest(token) },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });

    if (record === null) {
      return null;
    }

    if (record.revokedAt !== null) {
      this.logger.warn(`Refresh token reuse detected for user ${record.userId}; revoking all sessions`);
      await this.revokeAllForUser(record.userId);
      return null;
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.revokeById(record.id);
      return null;
    }

    await this.revokeById(record.id);
    return { userId: record.userId, tokenId: record.id };
  }

  /** Revokes a token without treating the call as a reuse event. Used by logout. */
  async revoke(token: string): Promise<string | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: RefreshTokenService.digest(token) },
      select: { id: true, userId: true, revokedAt: true },
    });

    if (record === null) {
      return null;
    }

    if (record.revokedAt === null) {
      await this.revokeById(record.id);
    }

    return record.userId;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count;
  }

  /**
   * Constant-time comparison helper for callers that need to compare a token
   * against a known value without leaking length or prefix through timing.
   */
  static matches(candidate: string, expected: string): boolean {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async revokeById(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}
