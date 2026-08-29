import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstCallArg } from '../common/testing/mock-args';
import type { Customer, Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import { CustomersService } from './customers.service';
import type { CustomerQueryDto } from './dto/customer-query.dto';

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    organizationId: 'org-1',
    customerCode: 'CUS-0001',
    firstName: 'Leila',
    lastName: 'Farouk',
    phone: '+15550100',
    email: 'leila.farouk@example.test',
    address: '12 Harbour Road',
    notes: null,
    tags: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function query(overrides: Partial<CustomerQueryDto> = {}): CustomerQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', includeDeleted: false, ...overrides };
}

describe('CustomersService', () => {
  let service: CustomersService;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let count: jest.Mock;
  let transaction: jest.Mock;
  let orderFindMany: jest.Mock;
  let orderCount: jest.Mock;
  let orderAggregate: jest.Mock;
  let repairFindMany: jest.Mock;
  let repairCount: jest.Mock;
  let returnFindMany: jest.Mock;
  let paymentAggregate: jest.Mock;
  let noteFindMany: jest.Mock;
  let noteCreate: jest.Mock;
  let addressFindMany: jest.Mock;
  let addressCreate: jest.Mock;
  let addressUpdate: jest.Mock;
  let addressUpdateMany: jest.Mock;
  let addressDelete: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    findUnique = jest.fn();
    findMany = jest.fn(() => Promise.resolve([customer()]));
    create = jest.fn(() => Promise.resolve(customer()));
    update = jest.fn((args: { data: Partial<Customer> }) => Promise.resolve(customer(args.data)));
    count = jest.fn(() => Promise.resolve(1));
    transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));

    orderFindMany = jest.fn(() => Promise.resolve([]));
    orderCount = jest.fn(() => Promise.resolve(0));
    orderAggregate = jest.fn(() => Promise.resolve({ _sum: { paidAmount: null } }));
    repairFindMany = jest.fn(() => Promise.resolve([]));
    repairCount = jest.fn(() => Promise.resolve(0));
    returnFindMany = jest.fn(() => Promise.resolve([]));
    paymentAggregate = jest.fn(() => Promise.resolve({ _sum: { amount: null } }));
    noteFindMany = jest.fn(() => Promise.resolve([]));
    noteCreate = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'note-1', ...args.data }));
    addressFindMany = jest.fn(() => Promise.resolve([]));
    addressCreate = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'address-1', ...args.data }));
    addressUpdate = jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'address-1', customerId: 'customer-1', ...args.data }));
    addressUpdateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    addressDelete = jest.fn(() => Promise.resolve({ id: 'address-1' }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: TENANT_PRISMA,
          useValue: {
            customer: { findUnique, findMany, create, update, count },
            order: { findMany: orderFindMany, count: orderCount, aggregate: orderAggregate },
            repair: { findMany: repairFindMany, count: repairCount },
            return: { findMany: returnFindMany },
            payment: { aggregate: paymentAggregate },
            customerNote: { findMany: noteFindMany, create: noteCreate },
            customerAddress: {
              findMany: addressFindMany,
              findUnique: jest.fn(() => Promise.resolve({ id: 'address-1', customerId: 'customer-1' })),
              create: addressCreate,
              update: addressUpdate,
              updateMany: addressUpdateMany,
              delete: addressDelete,
            },
            $transaction: transaction,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(CustomersService);
    findUnique.mockResolvedValue(customer());
  });

  function capturedWhere(): Prisma.CustomerWhereInput {
    return (firstCallArg(findMany) as { where: Prisma.CustomerWhereInput }).where;
  }

  describe('findAll', () => {
    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findAll(query());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns page metadata alongside the items', async () => {
      count.mockResolvedValue(45);

      const result = await service.findAll(query({ page: 3, limit: 10 }));

      expect(result.pagination).toEqual({ page: 3, limit: 10, total: 45, totalPages: 5 });
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });

    it('orders by the requested whitelisted column', async () => {
      await service.findAll(query({ sortBy: 'customerCode', sortOrder: 'asc' }));

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { customerCode: 'asc' } }));
    });

    it('hides soft-deleted customers by default', async () => {
      await service.findAll(query());

      expect(capturedWhere().deletedAt).toBeNull();
    });

    it('includes soft-deleted customers when asked', async () => {
      await service.findAll(query({ includeDeleted: true }));

      expect(capturedWhere()).not.toHaveProperty('deletedAt');
    });

    it('searches a single term across code, name, phone and email', async () => {
      await service.findAll(query({ search: 'farouk' }));

      const conditions = capturedWhere().AND;
      expect(Array.isArray(conditions)).toBe(true);
      expect(conditions).toEqual([
        {
          OR: [
            { customerCode: { contains: 'farouk', mode: 'insensitive' } },
            { firstName: { contains: 'farouk', mode: 'insensitive' } },
            { lastName: { contains: 'farouk', mode: 'insensitive' } },
            { phone: { contains: 'farouk', mode: 'insensitive' } },
            { email: { contains: 'farouk', mode: 'insensitive' } },
          ],
        },
      ]);
    });

    it('requires every term of a multi-word search to match somewhere', async () => {
      // "Leila Farouk" spans two columns, so OR-ing the whole phrase would
      // find nobody; each term is matched independently and then AND-ed.
      await service.findAll(query({ search: 'Leila  Farouk' }));

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

    it('applies an open-ended date range', async () => {
      const createdFrom = new Date('2026-01-01T00:00:00.000Z');

      await service.findAll(query({ createdFrom }));

      expect(capturedWhere().createdAt).toEqual({ gte: createdFrom });
    });
  });

  describe('findOne', () => {
    it('returns a live customer', async () => {
      findUnique.mockResolvedValue(customer());

      await expect(service.findOne('customer-1')).resolves.toMatchObject({ id: 'customer-1' });
    });

    it('raises a not-found for an unknown id', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });

    it('hides a soft-deleted customer from ordinary reads', async () => {
      findUnique.mockResolvedValue(customer({ deletedAt: new Date() }));

      await expect(service.findOne('customer-1')).rejects.toThrow(NotFoundException);
    });

    it('returns a soft-deleted customer when the caller needs it, as restore does', async () => {
      findUnique.mockResolvedValue(customer({ deletedAt: new Date() }));

      await expect(service.findOne('customer-1', true)).resolves.toMatchObject({ id: 'customer-1' });
    });
  });

  describe('create', () => {
    const dto = { customerCode: 'CUS-0009', firstName: 'Tomas', lastName: 'Berg', phone: '+15550101' };

    it('stores the customer with optional fields normalised to null', async () => {
      findUnique.mockResolvedValue(null);

      await service.create(dto);

      const { data } = firstCallArg(create) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ customerCode: 'CUS-0009', email: null, address: null, notes: null });
    });

    it('rejects a code that is already in use', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: null });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(create).not.toHaveBeenCalled();
    });

    it('says so when the code belongs to a deleted customer, rather than leaving the caller guessing', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: new Date() });

      await expect(service.create(dto)).rejects.toThrow(/deleted customer/i);
    });
  });

  describe('update', () => {
    it('changes only the fields that were supplied', async () => {
      findUnique.mockResolvedValue(customer());

      await service.update('customer-1', { phone: '+15559999' });

      const { data } = firstCallArg(update) as { data: Record<string, unknown> };
      expect(data).toEqual({ phone: '+15559999' });
    });

    it('lets a customer keep their own code', async () => {
      findUnique.mockResolvedValueOnce(customer()).mockResolvedValueOnce({ id: 'customer-1', deletedAt: null });

      await expect(service.update('customer-1', { customerCode: 'CUS-0001' })).resolves.toBeDefined();
    });

    it('rejects a code belonging to somebody else', async () => {
      findUnique.mockResolvedValueOnce(customer()).mockResolvedValueOnce({ id: 'someone-else', deletedAt: null });

      await expect(service.update('customer-1', { customerCode: 'CUS-0002' })).rejects.toThrow(ConflictException);
    });

    it('refuses to update a soft-deleted customer', async () => {
      findUnique.mockResolvedValue(customer({ deletedAt: new Date() }));

      await expect(service.update('customer-1', { phone: '+15559999' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('stamps deletedAt rather than deleting the row', async () => {
      findUnique.mockResolvedValue(customer());

      await service.remove('customer-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date } };
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('raises a not-found for a customer that is already deleted', async () => {
      findUnique.mockResolvedValue(customer({ deletedAt: new Date() }));

      await expect(service.remove('customer-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    it('clears deletedAt', async () => {
      findUnique.mockResolvedValue(customer({ deletedAt: new Date() }));

      await service.restore('customer-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date | null } };
      expect(data.deletedAt).toBeNull();
    });

    it('rejects restoring a customer that was never deleted', async () => {
      findUnique.mockResolvedValue(customer());

      await expect(service.restore('customer-1')).rejects.toThrow(ConflictException);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('lifetimeValue', () => {
    it('sums paid order amounts and repair payments', async () => {
      orderAggregate.mockResolvedValue({ _sum: { paidAmount: { toFixed: () => '100.00', add: (_n: { toFixed: () => string }) => ({ toFixed: () => '150.00' }) } } });
      paymentAggregate.mockResolvedValue({ _sum: { amount: { toFixed: () => '50.00' } } });

      const result = await service.lifetimeValue('customer-1');

      expect(result).toEqual({ orderRevenue: '100.00', repairRevenue: '50.00', total: '150.00' });
    });

    it('is zero when nothing has been collected yet', async () => {
      const result = await service.lifetimeValue('customer-1');

      expect(result).toEqual({ orderRevenue: '0.00', repairRevenue: '0.00', total: '0.00' });
    });

    it('404s for a customer that does not exist', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.lifetimeValue('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('outstanding', () => {
    it('only returns orders that are unpaid or partially paid', async () => {
      await service.outstanding('customer-1');

      const { where } = firstCallArg(orderFindMany) as { where: { paymentStatus: { in: string[] } } };
      expect(where.paymentStatus.in).toEqual(['UNPAID', 'PARTIAL']);
    });
  });

  describe('notes', () => {
    it('stamps the note with the calling user as author', async () => {
      await service.addNote('customer-1', { body: 'Called about a delayed delivery' }, 'user-1');

      const { data } = firstCallArg(noteCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ customerId: 'customer-1', authorId: 'user-1', body: 'Called about a delayed delivery' });
    });

    it('404s for a customer that does not exist', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.listNotes('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('addresses', () => {
    it('clears the previous default when a new address is marked default', async () => {
      await service.addAddress('customer-1', {
        label: 'Home',
        line1: '1 Main St',
        city: 'Cairo',
        state: 'Cairo',
        postalCode: '11511',
        country: 'Egypt',
        isDefault: true,
      });

      expect(addressUpdateMany).toHaveBeenCalledWith({ where: { customerId: 'customer-1', isDefault: true }, data: { isDefault: false } });
    });

    it('rejects updating an address that belongs to a different customer', async () => {
      await expect(service.updateAddress('someone-else', 'address-1', { label: 'Work' })).rejects.toThrow(NotFoundException);
    });
  });
});
