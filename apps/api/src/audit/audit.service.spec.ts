import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstCallArg } from '../common/testing/mock-args';
import { AuditAction, AuditEntity } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import type { AuditQueryDto } from './dto/audit-query.dto';

function query(overrides: Partial<AuditQueryDto> = {}): AuditQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', ...overrides };
}

describe('AuditService', () => {
  let service: AuditService;
  let create: jest.Mock;
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let count: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    create = jest.fn(() => Promise.resolve({}));
    findMany = jest.fn(() => Promise.resolve([{ id: 'entry-1' }]));
    findUnique = jest.fn(() => Promise.resolve({ id: 'entry-1' }));
    count = jest.fn(() => Promise.resolve(1));
    transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));

    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: { auditLog: { create, findMany, findUnique, count }, $transaction: transaction } }],
    }).compile();

    service = moduleRef.get(AuditService);
  });

  describe('record', () => {
    it('writes null for absent optional fields rather than leaving them undefined', async () => {
      await service.record({ userId: null, action: AuditAction.LOGIN_FAILED, entity: AuditEntity.AUTH });

      const { data } = firstCallArg(create) as { data: { entityId: string | null; ipAddress: string | null; userAgent: string | null } };
      expect(data.entityId).toBeNull();
      expect(data.ipAddress).toBeNull();
      expect(data.userAgent).toBeNull();
    });

    it('writes to the given transaction client instead of the default one when supplied', async () => {
      const txCreate = jest.fn(() => Promise.resolve({}));
      const tx = { auditLog: { create: txCreate } } as unknown as Parameters<AuditService['record']>[1];

      await service.record({ userId: 'user-1', action: AuditAction.CREATE, entity: AuditEntity.PRODUCT }, tx);

      expect(txCreate).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('filters by actor, action, entity and date range together', async () => {
      const createdFrom = new Date('2026-08-01T00:00:00.000Z');

      await service.findAll(query({ userId: 'user-1', action: AuditAction.LOGIN, entity: AuditEntity.AUTH, createdFrom }));

      const { where } = firstCallArg(findMany) as {
        where: { userId?: string; action?: AuditAction; entity?: AuditEntity; createdAt?: { gte: Date } };
      };
      expect(where.userId).toBe('user-1');
      expect(where.action).toBe(AuditAction.LOGIN);
      expect(where.entity).toBe(AuditEntity.AUTH);
      expect(where.createdAt).toEqual({ gte: createdFrom });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for an entry that does not exist', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
