import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { JwtConfiguration } from '../config/jwt.config';
import { jwtConfig } from '../config/jwt.config';
import { firstCallArg } from '../common/testing/mock-args';
import { hashPassword } from '../common/utils/password.util';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';

const PASSWORD = 'CorrectHorse1';

const config = {
  accessSecret: 'access-secret-that-is-long-enough-for-hs256',
  accessExpiresInSeconds: 900,
  refreshSecret: 'refresh-secret-that-is-long-enough-too',
  refreshExpiresInMs: 604_800_000,
} as JwtConfiguration;

interface StoredUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

async function storedUser(overrides: Partial<StoredUser> = {}): Promise<StoredUser> {
  return {
    id: 'user-1',
    firstName: 'Diego',
    lastName: 'Salas',
    email: 'diego@stockpro.test',
    passwordHash: await hashPassword(PASSWORD),
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let findUnique: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let count: jest.Mock;
  let issue: jest.Mock;
  let consume: jest.Mock;
  let revoke: jest.Mock;
  let revokeAllForUser: jest.Mock;

  beforeEach(async () => {
    findUnique = jest.fn();
    create = jest.fn();
    update = jest.fn(() => Promise.resolve({}));
    count = jest.fn(() => Promise.resolve(5));
    issue = jest.fn(() => Promise.resolve({ token: 'refresh-token-value', expiresAt: new Date(Date.now() + 1000) }));
    consume = jest.fn();
    revoke = jest.fn();
    revokeAllForUser = jest.fn(() => Promise.resolve(0));

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: PrismaService, useValue: { user: { findUnique, create, update, count } } },
        { provide: RefreshTokenService, useValue: { issue, consume, revoke, revokeAllForUser } },
        { provide: jwtConfig.KEY, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    await service.onModuleInit();
  });

  describe('register', () => {
    const dto = { firstName: 'Ana', lastName: 'Ruiz', email: 'ana@stockpro.test', password: PASSWORD };

    it('makes the very first account an administrator', async () => {
      findUnique.mockResolvedValue(null);
      count.mockResolvedValue(0);
      create.mockImplementation(async () => storedUser({ email: dto.email, role: UserRole.ADMIN }));

      await service.register(dto, {});

      expect((firstCallArg(create) as { data: { role: UserRole } }).data.role).toBe(UserRole.ADMIN);
    });

    it('creates every later self-registration as staff, never elevated', async () => {
      findUnique.mockResolvedValue(null);
      count.mockResolvedValue(3);
      create.mockImplementation(async () => storedUser({ email: dto.email }));

      await service.register(dto, {});

      expect((firstCallArg(create) as { data: { role: UserRole } }).data.role).toBe(UserRole.STAFF);
    });

    it('stores a hash, never the password', async () => {
      findUnique.mockResolvedValue(null);
      create.mockImplementation(async () => storedUser({ email: dto.email }));

      await service.register(dto, {});

      const { passwordHash } = (firstCallArg(create) as { data: { passwordHash: string } }).data;
      expect(passwordHash).toMatch(/^\$argon2id\$/);
      expect(passwordHash).not.toContain(PASSWORD);
    });

    it('rejects an email that is already taken', async () => {
      findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.register(dto, {})).rejects.toThrow(ConflictException);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues an access token and a refresh token', async () => {
      findUnique.mockResolvedValue(await storedUser());

      const session = await service.login({ email: 'diego@stockpro.test', password: PASSWORD }, {});

      expect(session.result.tokenType).toBe('Bearer');
      expect(session.result.expiresIn).toBe(900);
      expect(session.result.accessToken.split('.')).toHaveLength(3);
      expect(session.refreshToken.token).toBe('refresh-token-value');
      expect(issue).toHaveBeenCalledWith('user-1', {});
    });

    it('never returns the password hash', async () => {
      findUnique.mockResolvedValue(await storedUser());

      const session = await service.login({ email: 'diego@stockpro.test', password: PASSWORD }, {});

      expect(JSON.stringify(session.result.user)).not.toContain('argon2');
      expect(session.result.user).not.toHaveProperty('passwordHash');
    });

    it('records the sign-in time', async () => {
      findUnique.mockResolvedValue(await storedUser());

      await service.login({ email: 'diego@stockpro.test', password: PASSWORD }, {});

      expect(update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { lastLoginAt: expect.any(Date) as Date } });
    });

    it('gives the same message for an unknown email and a wrong password', async () => {
      findUnique.mockResolvedValue(null);
      const unknownEmail = await service.login({ email: 'nobody@stockpro.test', password: PASSWORD }, {}).catch((error: unknown) => error);

      findUnique.mockResolvedValue(await storedUser());
      const wrongPassword = await service.login({ email: 'diego@stockpro.test', password: 'WrongPassword1' }, {}).catch((error: unknown) => error);

      expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
      expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
      expect((unknownEmail as UnauthorizedException).getResponse()).toEqual((wrongPassword as UnauthorizedException).getResponse());
    });

    it('hashes a candidate password even when the account does not exist', async () => {
      findUnique.mockResolvedValue(null);

      // A miss that skipped hashing would answer in microseconds and so
      // enumerate accounts; this asserts the decoy verification really runs.
      const started = process.hrtime.bigint();
      await service.login({ email: 'nobody@stockpro.test', password: PASSWORD }, {}).catch(() => undefined);
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

      expect(elapsedMs).toBeGreaterThan(5);
    });

    it.each([[UserStatus.INACTIVE], [UserStatus.SUSPENDED]])('refuses a %s account that knows its password', async (status: UserStatus) => {
      findUnique.mockResolvedValue(await storedUser({ status }));

      await expect(service.login({ email: 'diego@stockpro.test', password: PASSWORD }, {})).rejects.toThrow(ForbiddenException);
      expect(issue).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('consumes the presented token and issues a new pair', async () => {
      consume.mockResolvedValue({ userId: 'user-1', tokenId: 'token-1' });
      findUnique.mockResolvedValue(await storedUser());

      const session = await service.refresh('presented', {});

      expect(consume).toHaveBeenCalledWith('presented');
      expect(session.result.accessToken.split('.')).toHaveLength(3);
      expect(issue).toHaveBeenCalledTimes(1);
    });

    it('refuses a token the store rejected, without issuing anything', async () => {
      consume.mockResolvedValue(null);

      await expect(service.refresh('stale', {})).rejects.toThrow(UnauthorizedException);
      expect(issue).not.toHaveBeenCalled();
    });

    it('ends every session when the account is no longer active', async () => {
      consume.mockResolvedValue({ userId: 'user-1', tokenId: 'token-1' });
      findUnique.mockResolvedValue(await storedUser({ status: UserStatus.SUSPENDED }));

      await expect(service.refresh('presented', {})).rejects.toThrow(UnauthorizedException);
      expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('ends every session when the account has disappeared', async () => {
      consume.mockResolvedValue({ userId: 'user-1', tokenId: 'token-1' });
      findUnique.mockResolvedValue(null);

      await expect(service.refresh('presented', {})).rejects.toThrow(UnauthorizedException);
      expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('logout', () => {
    it('revokes the presented token', async () => {
      await service.logout('presented');

      expect(revoke).toHaveBeenCalledWith('presented');
    });

    it.each([[undefined], ['']])('is a no-op for %p rather than an error', async (token: string | undefined) => {
      await expect(service.logout(token)).resolves.toBeUndefined();
      expect(revoke).not.toHaveBeenCalled();
    });
  });

  describe('currentUser', () => {
    it('reads the record fresh rather than trusting the token claims', async () => {
      findUnique.mockResolvedValue(await storedUser({ role: UserRole.MANAGER }));

      const user = await service.currentUser({ id: 'user-1', email: 'diego@stockpro.test', role: UserRole.STAFF });

      expect(user.role).toBe(UserRole.MANAGER);
    });

    it('refuses a caller whose account was deactivated after the token was issued', async () => {
      findUnique.mockResolvedValue(await storedUser({ status: UserStatus.INACTIVE }));

      await expect(service.currentUser({ id: 'user-1', email: 'diego@stockpro.test', role: UserRole.STAFF })).rejects.toThrow(UnauthorizedException);
    });
  });
});
