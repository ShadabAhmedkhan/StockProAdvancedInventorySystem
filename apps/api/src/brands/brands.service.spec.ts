import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstCallArg } from '../common/testing/mock-args';
import type { Brand, Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import { BrandsService } from './brands.service';
import type { BrandQueryDto } from './dto/brand-query.dto';

function brand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    organizationId: 'org-1',
    name: 'Aureon',
    slug: 'aureon',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function query(overrides: Partial<BrandQueryDto> = {}): BrandQueryDto {
  return { page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc', includeDeleted: false, ...overrides };
}

describe('BrandsService', () => {
  let service: BrandsService;
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let count: jest.Mock;
  let productCount: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    findUnique = jest.fn(() => Promise.resolve(null));
    findMany = jest.fn(() => Promise.resolve([brand()]));
    create = jest.fn(() => Promise.resolve(brand()));
    update = jest.fn((args: { data: Partial<Brand> }) => Promise.resolve(brand(args.data)));
    count = jest.fn(() => Promise.resolve(1));
    productCount = jest.fn(() => Promise.resolve(0));
    transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));

    const moduleRef = await Test.createTestingModule({
      providers: [
        BrandsService,
        {
          provide: TENANT_PRISMA,
          useValue: { brand: { findUnique, findMany, create, update, count }, product: { count: productCount }, $transaction: transaction },
        },
      ],
    }).compile();

    service = moduleRef.get(BrandsService);
  });

  describe('findAll', () => {
    it('hides soft-deleted brands by default', async () => {
      await service.findAll(query());

      const { where } = firstCallArg(findMany) as { where: Prisma.BrandWhereInput };
      expect(where.deletedAt).toBeNull();
    });

    it('defaults to ascending by name, which is what a picker needs', async () => {
      await service.findAll(query());

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
    });

    it('searches name and slug', async () => {
      await service.findAll(query({ search: 'aur' }));

      const { where } = firstCallArg(findMany) as { where: Prisma.BrandWhereInput };
      expect(where.AND).toEqual([
        {
          OR: [{ name: { contains: 'aur', mode: 'insensitive' } }, { slug: { contains: 'aur', mode: 'insensitive' } }],
        },
      ]);
    });
  });

  describe('create', () => {
    it('derives the slug from the name when one is not supplied', async () => {
      await service.create({ name: 'Volta Power' });

      const { data } = firstCallArg(create) as { data: { slug: string } };
      expect(data.slug).toBe('volta-power');
    });

    it('keeps an explicitly supplied slug', async () => {
      await service.create({ name: 'Volta Power', slug: 'volta' });

      const { data } = firstCallArg(create) as { data: { slug: string } };
      expect(data.slug).toBe('volta');
    });

    it('asks for a slug rather than storing an empty one it cannot derive', async () => {
      const error = await service.create({ name: '!!!' }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((error as BadRequestException).getResponse())).toContain('slug');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate name', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: null });

      await expect(service.create({ name: 'Aureon' })).rejects.toThrow(ConflictException);
    });

    it('says so when the name belongs to a deleted brand', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: new Date() });

      await expect(service.create({ name: 'Aureon' })).rejects.toThrow(/deleted brand/i);
    });
  });

  describe('update', () => {
    it('does not re-derive the slug when only the name changes', async () => {
      findUnique.mockResolvedValueOnce(brand()).mockResolvedValue(null);

      await service.update('brand-1', { name: 'Aureon Global' });

      const { data } = firstCallArg(update) as { data: Record<string, unknown> };
      expect(data).toEqual({ name: 'Aureon Global' });
      expect(data).not.toHaveProperty('slug');
    });
  });

  describe('remove', () => {
    it('soft-deletes a brand that no product uses', async () => {
      findUnique.mockResolvedValue(brand());
      productCount.mockResolvedValue(0);

      await service.remove('brand-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date } };
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('refuses while live products still reference it', async () => {
      findUnique.mockResolvedValue(brand());
      productCount.mockResolvedValue(3);

      await expect(service.remove('brand-1')).rejects.toThrow(/used by 3 product/);
      expect(update).not.toHaveBeenCalled();
    });

    it('counts only live products, so deleted ones do not block it', async () => {
      findUnique.mockResolvedValue(brand());

      await service.remove('brand-1');

      const { where } = firstCallArg(productCount) as { where: Record<string, unknown> };
      expect(where).toEqual({ brandId: 'brand-1', deletedAt: null });
    });

    it('raises a not-found for a brand that is already deleted', async () => {
      findUnique.mockResolvedValue(brand({ deletedAt: new Date() }));

      await expect(service.remove('brand-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    it('clears deletedAt', async () => {
      findUnique.mockResolvedValue(brand({ deletedAt: new Date() }));

      await service.restore('brand-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date | null } };
      expect(data.deletedAt).toBeNull();
    });

    it('rejects restoring a brand that was never deleted', async () => {
      findUnique.mockResolvedValue(brand());

      await expect(service.restore('brand-1')).rejects.toThrow(ConflictException);
    });
  });
});
