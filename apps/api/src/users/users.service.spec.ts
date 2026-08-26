import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { AuditService } from '../audit/audit.service';
import { firstCallArg } from '../common/testing/mock-args';
import * as tenantContext from '../common/tenant/tenant-context';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import type { UserQueryDto } from './dto/user-query.dto';
import { UsersService } from './users.service';

const CALLER_ID = 'caller-1';

function user(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    firstName: 'Diego',
    lastName: 'Salas',
    email: 'diego@stockpro.test',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function query(overrides: Partial<UserQueryDto> = {}): UserQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', ...overrides };
}

describe('UsersService', () => {
  let service: UsersService;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let count: jest.Mock;
  let transaction: jest.Mock;
  let revokeAllForUser: jest.Mock;
  let record: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    findUnique = jest.fn();
    findMany = jest.fn(() => Promise.resolve([user()]));
    create = jest.fn(() => Promise.resolve(user()));
    update = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve(user(args.data)));
    count = jest.fn(() => Promise.resolve(1));
    // The service passes an array of unresolved queries to $transaction.
    transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));
    revokeAllForUser = jest.fn(() => Promise.resolve(2));
    record = jest.fn(() => Promise.resolve());

    const client = { user: { findUnique, findMany, create, update, count }, $transaction: transaction };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: client },
        { provide: TENANT_PRISMA, useValue: client },
        { provide: RefreshTokenService, useValue: { revokeAllForUser } },
        { provide: AuditService, useValue: { record } },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  describe('findAll', () => {
    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findAll(query());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns page metadata alongside the items', async () => {
      count.mockResolvedValue(45);

      const result = await service.findAll(query({ page: 2, limit: 20 }));

      expect(result.pagination).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
    });

    it('orders by the requested whitelisted column', async () => {
      await service.findAll(query({ sortBy: 'email', sortOrder: 'asc' }));

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { email: 'asc' } }));
    });

    it('searches names and email case-insensitively', async () => {
      await service.findAll(query({ search: 'salas' }));

      const { where } = firstCallArg(findMany) as { where: { OR: unknown[] } };
      expect(where.OR).toEqual([
        { firstName: { contains: 'salas', mode: 'insensitive' } },
        { lastName: { contains: 'salas', mode: 'insensitive' } },
        { email: { contains: 'salas', mode: 'insensitive' } },
      ]);
    });

    it('combines role and status filters with the search', async () => {
      await service.findAll(query({ role: UserRole.ADMIN, status: UserStatus.ACTIVE, search: 'a' }));

      const { where } = firstCallArg(findMany) as { where: Record<string, unknown> };
      expect(where.role).toBe(UserRole.ADMIN);
      expect(where.status).toBe(UserStatus.ACTIVE);
      expect(where.OR).toBeDefined();
    });

    it('never selects the password hash', async () => {
      await service.findAll(query());

      const { select } = firstCallArg(findMany) as { select: Record<string, unknown> };
      expect(select).not.toHaveProperty('passwordHash');
    });
  });

  describe('findOne', () => {
    it('raises a not-found rather than returning null', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    const dto = {
      firstName: 'Ana',
      lastName: 'Ruiz',
      email: 'ana@stockpro.test',
      password: 'CorrectHorse1',
      role: UserRole.MANAGER,
      status: UserStatus.ACTIVE,
    };

    it('hashes the password and honours the requested role', async () => {
      findUnique.mockResolvedValue(null);

      await service.create(dto, CALLER_ID);

      const { data } = firstCallArg(create) as { data: { passwordHash: string; role: UserRole } };
      expect(data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(data.role).toBe(UserRole.MANAGER);
    });

    it('rejects a duplicate email', async () => {
      findUnique.mockResolvedValue({ id: 'other' });

      await expect(service.create(dto, CALLER_ID)).rejects.toThrow(ConflictException);
    });

    it('records who created the account', async () => {
      findUnique.mockResolvedValue(null);

      await service.create(dto, CALLER_ID);

      expect(record).toHaveBeenCalledWith(expect.objectContaining({ userId: CALLER_ID, action: 'CREATE', entity: 'USER', entityId: 'user-1' }));
    });
  });

  describe('update', () => {
    it('allows a user to keep their own email', async () => {
      findUnique.mockResolvedValueOnce(user()).mockResolvedValueOnce({ id: 'user-1' });

      await expect(service.update('user-1', { email: 'diego@stockpro.test' })).resolves.toBeDefined();
    });

    it('rejects an email belonging to somebody else', async () => {
      findUnique.mockResolvedValueOnce(user()).mockResolvedValueOnce({ id: 'someone-else' });

      await expect(service.update('user-1', { email: 'taken@stockpro.test' })).rejects.toThrow(ConflictException);
    });
  });

  describe('changeRole', () => {
    it('promotes another user', async () => {
      findUnique.mockResolvedValue(user());

      const result = await service.changeRole('user-1', UserRole.MANAGER, CALLER_ID);

      expect(result.role).toBe(UserRole.MANAGER);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ userId: CALLER_ID, action: 'ROLE_CHANGED', entityId: 'user-1', metadata: { from: UserRole.STAFF, to: UserRole.MANAGER } }),
      );
    });

    it('refuses to let an administrator change their own role', async () => {
      findUnique.mockResolvedValue(user({ id: CALLER_ID, role: UserRole.ADMIN }));

      await expect(service.changeRole(CALLER_ID, UserRole.STAFF, CALLER_ID)).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses to demote the last active administrator', async () => {
      findUnique.mockResolvedValue(user({ role: UserRole.ADMIN }));
      count.mockResolvedValue(0);

      await expect(service.changeRole('user-1', UserRole.STAFF, CALLER_ID)).rejects.toThrow(/last active administrator/);
    });

    it('allows demoting an administrator while another remains', async () => {
      findUnique.mockResolvedValue(user({ role: UserRole.ADMIN }));
      count.mockResolvedValue(1);

      await expect(service.changeRole('user-1', UserRole.STAFF, CALLER_ID)).resolves.toBeDefined();
    });
  });

  describe('changeStatus', () => {
    it('ends every session when a user is deactivated', async () => {
      findUnique.mockResolvedValue(user());

      await service.changeStatus('user-1', UserStatus.SUSPENDED, CALLER_ID);

      expect(revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ userId: CALLER_ID, action: 'STATUS_CHANGED', entityId: 'user-1' }));
    });

    it('leaves sessions alone when a user is reactivated', async () => {
      findUnique.mockResolvedValue(user({ status: UserStatus.INACTIVE }));

      await service.changeStatus('user-1', UserStatus.ACTIVE, CALLER_ID);

      expect(revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses to let a caller lock themselves out', async () => {
      findUnique.mockResolvedValue(user({ id: CALLER_ID }));

      await expect(service.changeStatus(CALLER_ID, UserStatus.INACTIVE, CALLER_ID)).rejects.toThrow(BadRequestException);
    });

    it('refuses to deactivate the last active administrator', async () => {
      findUnique.mockResolvedValue(user({ role: UserRole.ADMIN }));
      count.mockResolvedValue(0);

      await expect(service.changeStatus('user-1', UserStatus.INACTIVE, CALLER_ID)).rejects.toThrow(/last active administrator/);
    });
  });
});
