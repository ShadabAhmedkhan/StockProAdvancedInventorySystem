import { Test } from '@nestjs/testing';
import { firstCallArg } from '../common/testing/mock-args';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetService } from './password-reset.service';

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let findUnique: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    create = jest.fn(() => Promise.resolve({}));
    update = jest.fn(() => Promise.resolve({}));

    const moduleRef = await Test.createTestingModule({
      providers: [PasswordResetService, { provide: PrismaService, useValue: { passwordResetToken: { findUnique, create, update } } }],
    }).compile();

    service = moduleRef.get(PasswordResetService);
  });

  describe('issue', () => {
    it('stores only a digest, never the token itself', async () => {
      const issued = await service.issue('user-1');

      const stored = (firstCallArg(create) as { data: { tokenHash: string; userId: string } }).data;
      expect(stored.userId).toBe('user-1');
      expect(stored.tokenHash).toBe(PasswordResetService.digest(issued.token));
      expect(stored.tokenHash).not.toBe(issued.token);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('mints a distinct high-entropy token each time', async () => {
      const tokens = await Promise.all([service.issue('user-1'), service.issue('user-1'), service.issue('user-1')]);
      const values = tokens.map((token) => token.token);

      expect(new Set(values).size).toBe(3);
    });

    it('expires about an hour from now', async () => {
      const issued = await service.issue('user-1');

      const ttlMs = 60 * 60 * 1000;
      expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(ttlMs - 5_000);
      expect(issued.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(ttlMs);
    });
  });

  describe('consume', () => {
    it('returns the owner and marks the token used, so it works exactly once', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000), usedAt: null });

      await expect(service.consume('presented')).resolves.toBe('user-1');
      expect(update).toHaveBeenCalledWith({ where: { id: 'token-1' }, data: { usedAt: expect.any(Date) as Date } });
    });

    it('rejects an unknown token', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.consume('nonsense')).resolves.toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects an expired token without spending it again', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: new Date(Date.now() - 1), usedAt: null });

      await expect(service.consume('stale')).resolves.toBeNull();
      expect(update).not.toHaveBeenCalled();
    });

    it('rejects a token that was already used', async () => {
      findUnique.mockResolvedValue({ id: 'token-1', userId: 'user-1', expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() });

      await expect(service.consume('replayed')).resolves.toBeNull();
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('digest', () => {
    it('is deterministic and collision-free across values', () => {
      expect(PasswordResetService.digest('abc')).toBe(PasswordResetService.digest('abc'));
      expect(PasswordResetService.digest('abc')).not.toBe(PasswordResetService.digest('abd'));
    });
  });
});
