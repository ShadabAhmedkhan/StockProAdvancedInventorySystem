import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { JwtConfiguration } from '../config/jwt.config';
import { jwtConfig } from '../config/jwt.config';
import { firstCallArg } from '../common/testing/mock-args';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

const config = { refreshExpiresInMs: 604_800_000 } as JwtConfiguration;

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let findUnique: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let updateMany: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    create = jest.fn(() => Promise.resolve({}));
    update = jest.fn(() => Promise.resolve({}));
    updateMany = jest.fn(() => Promise.resolve({ count: 3 }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: PrismaService, useValue: { refreshToken: { findUnique, create, update, updateMany } } },
        { provide: jwtConfig.KEY, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(RefreshTokenService);
    // The reuse path logs a warning; keep the test output readable.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('issue', () => {
    it('stores only a digest, never the token itself', async () => {
      const issued = await service.issue('user-1');

      const stored = (firstCallArg(create) as { data: { tokenHash: string; userId: string } }).data;
      expect(stored.userId).toBe('user-1');
      expect(stored.tokenHash).toBe(RefreshTokenService.digest(issued.token));
      expect(stored.tokenHash).not.toBe(issued.token);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('mints a distinct high-entropy token each time', async () => {
      const tokens = await Promise.all([service.issue('user-1'), service.issue('user-1'), service.issue('user-1')]);
      const values = tokens.map((token) => token.token);

      expect(new Set(values).size).toBe(3);
      for (const value of values) {
        expect(value.length).toBeGreaterThanOrEqual(64);
      }
    });

    it('sets the expiry from configuration', async () => {
      const issued = await service.issue('user-1');

      expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(config.refreshExpiresInMs - 5_000);
    });

    it('records where the session came from', async () => {
      await service.issue('user-1', { userAgent: 'jest', ipAddress: '203.0.113.7' });

      const stored = (firstCallArg(create) as { data: { userAgent: string; ipAddress: string } }).data;
      expect(stored.userAgent).toBe('jest');
      expect(stored.ipAddress).toBe('203.0.113.7');
    });
  });

  describe('consume', () => {
    it('returns the owner and revokes the token, so it works exactly once', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null });

      await expect(service.consume('presented')).resolves.toEqual({ userId: 'user-1', tokenId: 'token-1' });
      expect(update).toHaveBeenCalledWith({ where: { id: 'token-1' }, data: { revokedAt: expect.any(Date) as Date } });
    });

    it('rejects an unknown token', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.consume('nonsense')).resolves.toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects an expired token and revokes it', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: new Date(Date.now() - 1), revokedAt: null });

      await expect(service.consume('stale')).resolves.toBeNull();
      expect(update).toHaveBeenCalledWith({ where: { id: 'token-1' }, data: { revokedAt: expect.any(Date) as Date } });
    });

    it('treats reuse of an already-revoked token as theft and ends every session', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() });

      await expect(service.consume('replayed')).resolves.toBeNull();
      expect(updateMany).toHaveBeenCalledWith({ where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: expect.any(Date) as Date } });
    });
  });

  describe('revoke', () => {
    it('revokes a live token without triggering the reuse response', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', revokedAt: null });

      await expect(service.revoke('presented')).resolves.toBe('user-1');
      expect(update).toHaveBeenCalledTimes(1);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent for a token that is already revoked', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', revokedAt: new Date() });

      await expect(service.revoke('presented')).resolves.toBe('user-1');
      expect(update).not.toHaveBeenCalled();
    });

    it('returns null for an unknown token', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.revoke('nonsense')).resolves.toBeNull();
    });
  });

  describe('digest', () => {
    it('is deterministic and collision-free across values', () => {
      expect(RefreshTokenService.digest('abc')).toBe(RefreshTokenService.digest('abc'));
      expect(RefreshTokenService.digest('abc')).not.toBe(RefreshTokenService.digest('abd'));
    });
  });

  describe('matches', () => {
    it('compares equal values as equal and differing values as different', () => {
      expect(RefreshTokenService.matches('token', 'token')).toBe(true);
      expect(RefreshTokenService.matches('token', 'tokes')).toBe(false);
      expect(RefreshTokenService.matches('token', 'token-longer')).toBe(false);
    });
  });
});
