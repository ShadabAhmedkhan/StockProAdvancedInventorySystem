import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 384 bits of entropy, matching `RefreshTokenService`. */
const TOKEN_BYTES = 48;

/** A reset link is short-lived: long enough for a real email round-trip, short
 * enough that a leaked-but-unused link is worthless within the hour. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface IssuedPasswordResetToken {
  /** The value put in the emailed link. Never stored. */
  token: string;
  expiresAt: Date;
}

/**
 * Issues and consumes password-reset tokens.
 *
 * Mirrors `RefreshTokenService`: the token is opaque random data, only its
 * SHA-256 digest is persisted, so a database leak cannot be replayed as a
 * working reset link. Consuming a token is single-use - `usedAt` is set the
 * moment it is spent, whether or not the reset that follows succeeds - so a
 * captured link cannot be replayed even if the first attempt failed for an
 * unrelated reason.
 */
@Injectable()
export class PasswordResetService {
  constructor(private readonly prisma: PrismaService) {}

  static digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string): Promise<IssuedPasswordResetToken> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash: PasswordResetService.digest(token), expiresAt },
    });

    return { token, expiresAt };
  }

  /**
   * Validates a presented token and marks it spent.
   *
   * Returns the owning user id when the token was live and unused, `null`
   * otherwise (unknown, expired, or already used).
   */
  async consume(token: string): Promise<string | null> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: PasswordResetService.digest(token) },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    if (record === null) {
      return null;
    }

    if (record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    await this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

    return record.userId;
  }
}
