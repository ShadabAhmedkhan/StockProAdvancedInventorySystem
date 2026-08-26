import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstCallArg } from '../common/testing/mock-args';
import type { Prisma, Supplier } from '../generated/prisma/client';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import type { SupplierQueryDto } from './dto/supplier-query.dto';
import { SuppliersService } from './suppliers.service';

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 'supplier-1',
    organizationId: 'org-1',
    supplierCode: 'SUP-0001',
    name: 'Northwind Components',
    contactPerson: 'Elena Petrova',
    phone: '+15550200',
    email: 'sales@northwind.test',
    address: '1 Industrial Park',
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function query(overrides: Partial<SupplierQueryDto> = {}): SupplierQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', includeDeleted: false, ...overrides };
}

describe('SuppliersService', () => {
  let service: SuppliersService;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let count: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    findUnique = jest.fn();
    findMany = jest.fn(() => Promise.resolve([supplier()]));
    create = jest.fn(() => Promise.resolve(supplier()));
    update = jest.fn((args: { data: Partial<Supplier> }) => Promise.resolve(supplier(args.data)));
    count = jest.fn(() => Promise.resolve(1));
    transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));

    const moduleRef = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: TENANT_PRISMA, useValue: { supplier: { findUnique, findMany, create, update, count }, $transaction: transaction } },
      ],
    }).compile();

    service = moduleRef.get(SuppliersService);
  });

  function capturedWhere(): Prisma.SupplierWhereInput {
    return (firstCallArg(findMany) as { where: Prisma.SupplierWhereInput }).where;
  }

  describe('findAll', () => {
    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findAll(query());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns page metadata alongside the items', async () => {
      count.mockResolvedValue(31);

      const result = await service.findAll(query({ page: 2, limit: 10 }));

      expect(result.pagination).toEqual({ page: 2, limit: 10, total: 31, totalPages: 4 });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    });

    it('orders by the requested whitelisted column', async () => {
      await service.findAll(query({ sortBy: 'name', sortOrder: 'asc' }));

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
    });

    it('hides soft-deleted suppliers by default', async () => {
      await service.findAll(query());

      expect(capturedWhere().deletedAt).toBeNull();
    });

    it('includes soft-deleted suppliers when asked', async () => {
      await service.findAll(query({ includeDeleted: true }));

      expect(capturedWhere()).not.toHaveProperty('deletedAt');
    });

    it('searches code, name, contact, phone and email', async () => {
      await service.findAll(query({ search: 'northwind' }));

      expect(capturedWhere().AND).toEqual([
        {
          OR: [
            { supplierCode: { contains: 'northwind', mode: 'insensitive' } },
            { name: { contains: 'northwind', mode: 'insensitive' } },
            { contactPerson: { contains: 'northwind', mode: 'insensitive' } },
            { phone: { contains: 'northwind', mode: 'insensitive' } },
            { email: { contains: 'northwind', mode: 'insensitive' } },
          ],
        },
      ]);
    });

    it('requires every term of a multi-word search to match somewhere', async () => {
      await service.findAll(query({ search: 'Elena  Petrova' }));

      const conditions = capturedWhere().AND;
      expect(Array.isArray(conditions) ? conditions : []).toHaveLength(2);
    });

    it('ignores a search of only whitespace', async () => {
      await service.findAll(query({ search: '   ' }));

      expect(capturedWhere()).not.toHaveProperty('AND');
    });

    it('applies a created-date range', async () => {
      const createdFrom = new Date('2026-01-01T00:00:00.000Z');
      const createdTo = new Date('2026-02-01T00:00:00.000Z');

      await service.findAll(query({ createdFrom, createdTo }));

      expect(capturedWhere().createdAt).toEqual({ gte: createdFrom, lte: createdTo });
    });
  });

  describe('findOne', () => {
    it('returns a live supplier', async () => {
      findUnique.mockResolvedValue(supplier());

      await expect(service.findOne('supplier-1')).resolves.toMatchObject({ id: 'supplier-1' });
    });

    it('raises a not-found for an unknown id', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('hides a soft-deleted supplier from ordinary reads', async () => {
      findUnique.mockResolvedValue(supplier({ deletedAt: new Date() }));

      await expect(service.findOne('supplier-1')).rejects.toThrow(NotFoundException);
    });

    it('returns a soft-deleted supplier when the caller needs it, as restore does', async () => {
      findUnique.mockResolvedValue(supplier({ deletedAt: new Date() }));

      await expect(service.findOne('supplier-1', true)).resolves.toMatchObject({ id: 'supplier-1' });
    });
  });

  describe('create', () => {
    const dto = { supplierCode: 'SUP-0009', name: 'Vertex Displays', phone: '+15550203' };

    it('stores the supplier with optional fields normalised to null', async () => {
      findUnique.mockResolvedValue(null);

      await service.create(dto);

      const { data } = firstCallArg(create) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ supplierCode: 'SUP-0009', contactPerson: null, email: null, address: null, notes: null });
    });

    it('rejects a code that is already in use', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: null });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(create).not.toHaveBeenCalled();
    });

    it('says so when the code belongs to a deleted supplier', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: new Date() });

      await expect(service.create(dto)).rejects.toThrow(/deleted supplier/i);
    });
  });

  describe('update', () => {
    it('changes only the fields that were supplied', async () => {
      findUnique.mockResolvedValue(supplier());

      await service.update('supplier-1', { contactPerson: 'Mei Lin' });

      const { data } = firstCallArg(update) as { data: Record<string, unknown> };
      expect(data).toEqual({ contactPerson: 'Mei Lin' });
    });

    it('lets a supplier keep their own code', async () => {
      findUnique.mockResolvedValueOnce(supplier()).mockResolvedValueOnce({ id: 'supplier-1', deletedAt: null });

      await expect(service.update('supplier-1', { supplierCode: 'SUP-0001' })).resolves.toBeDefined();
    });

    it('rejects a code belonging to another supplier', async () => {
      findUnique.mockResolvedValueOnce(supplier()).mockResolvedValueOnce({ id: 'someone-else', deletedAt: null });

      await expect(service.update('supplier-1', { supplierCode: 'SUP-0002' })).rejects.toThrow(ConflictException);
    });

    it('refuses to update a soft-deleted supplier', async () => {
      findUnique.mockResolvedValue(supplier({ deletedAt: new Date() }));

      await expect(service.update('supplier-1', { phone: '+15559999' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('stamps deletedAt rather than deleting the row', async () => {
      findUnique.mockResolvedValue(supplier());

      await service.remove('supplier-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date } };
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('raises a not-found for a supplier that is already deleted', async () => {
      findUnique.mockResolvedValue(supplier({ deletedAt: new Date() }));

      await expect(service.remove('supplier-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    it('clears deletedAt', async () => {
      findUnique.mockResolvedValue(supplier({ deletedAt: new Date() }));

      await service.restore('supplier-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date | null } };
      expect(data.deletedAt).toBeNull();
    });

    it('rejects restoring a supplier that was never deleted', async () => {
      findUnique.mockResolvedValue(supplier());

      await expect(service.restore('supplier-1')).rejects.toThrow(ConflictException);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
