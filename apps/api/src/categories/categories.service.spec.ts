import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstCallArg } from '../common/testing/mock-args';
import type { Category, Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import { CategoriesService } from './categories.service';
import type { CategoryQueryDto } from './dto/category-query.dto';

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'category-1',
    organizationId: 'org-1',
    name: 'Smartphones',
    slug: 'smartphones',
    description: 'Handsets sold new and refurbished',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function query(overrides: Partial<CategoryQueryDto> = {}): CategoryQueryDto {
  return { page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc', includeDeleted: false, ...overrides };
}

describe('CategoriesService', () => {
  let service: CategoriesService;
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
    findMany = jest.fn(() => Promise.resolve([category()]));
    create = jest.fn(() => Promise.resolve(category()));
    update = jest.fn((args: { data: Partial<Category> }) => Promise.resolve(category(args.data)));
    count = jest.fn(() => Promise.resolve(1));
    productCount = jest.fn(() => Promise.resolve(0));
    transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));

    const moduleRef = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: TENANT_PRISMA,
          useValue: { category: { findUnique, findMany, create, update, count }, product: { count: productCount }, $transaction: transaction },
        },
      ],
    }).compile();

    service = moduleRef.get(CategoriesService);
  });

  describe('findAll', () => {
    it('hides soft-deleted categories by default', async () => {
      await service.findAll(query());

      const { where } = firstCallArg(findMany) as { where: Prisma.CategoryWhereInput };
      expect(where.deletedAt).toBeNull();
    });

    it('defaults to ascending by name, which is what a picker needs', async () => {
      await service.findAll(query());

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { name: 'asc' } }));
    });

    it('searches name, slug and description', async () => {
      await service.findAll(query({ search: 'phone' }));

      const { where } = firstCallArg(findMany) as { where: Prisma.CategoryWhereInput };
      expect(where.AND).toEqual([
        {
          OR: [
            { name: { contains: 'phone', mode: 'insensitive' } },
            { slug: { contains: 'phone', mode: 'insensitive' } },
            { description: { contains: 'phone', mode: 'insensitive' } },
          ],
        },
      ]);
    });
  });

  describe('create', () => {
    it('derives the slug from the name when one is not supplied', async () => {
      await service.create({ name: 'Spare Parts' });

      const { data } = firstCallArg(create) as { data: { slug: string } };
      expect(data.slug).toBe('spare-parts');
    });

    it('keeps an explicitly supplied slug', async () => {
      await service.create({ name: 'Spare Parts', slug: 'parts' });

      const { data } = firstCallArg(create) as { data: { slug: string } };
      expect(data.slug).toBe('parts');
    });

    it('asks for a slug rather than storing an empty one it cannot derive', async () => {
      const error = await service.create({ name: '!!!' }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((error as BadRequestException).getResponse())).toContain('slug');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate name', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: null });

      await expect(service.create({ name: 'Smartphones' })).rejects.toThrow(ConflictException);
    });

    it('says so when the name belongs to a deleted category', async () => {
      findUnique.mockResolvedValue({ id: 'other', deletedAt: new Date() });

      await expect(service.create({ name: 'Smartphones' })).rejects.toThrow(/deleted category/i);
    });
  });

  describe('update', () => {
    it('does not re-derive the slug when only the name changes', async () => {
      findUnique.mockResolvedValueOnce(category()).mockResolvedValue(null);

      await service.update('category-1', { name: 'Mobile Phones' });

      const { data } = firstCallArg(update) as { data: Record<string, unknown> };
      expect(data).toEqual({ name: 'Mobile Phones' });
      expect(data).not.toHaveProperty('slug');
    });
  });

  describe('remove', () => {
    it('soft-deletes a category that no product uses', async () => {
      findUnique.mockResolvedValue(category());
      productCount.mockResolvedValue(0);

      await service.remove('category-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date } };
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('refuses while live products still reference it', async () => {
      findUnique.mockResolvedValue(category());
      productCount.mockResolvedValue(3);

      await expect(service.remove('category-1')).rejects.toThrow(/used by 3 product/);
      expect(update).not.toHaveBeenCalled();
    });

    it('counts only live products, so deleted ones do not block it', async () => {
      findUnique.mockResolvedValue(category());

      await service.remove('category-1');

      const { where } = firstCallArg(productCount) as { where: Record<string, unknown> };
      expect(where).toEqual({ categoryId: 'category-1', deletedAt: null });
    });

    it('raises a not-found for a category that is already deleted', async () => {
      findUnique.mockResolvedValue(category({ deletedAt: new Date() }));

      await expect(service.remove('category-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    it('clears deletedAt', async () => {
      findUnique.mockResolvedValue(category({ deletedAt: new Date() }));

      await service.restore('category-1');

      const { data } = firstCallArg(update) as { data: { deletedAt: Date | null } };
      expect(data.deletedAt).toBeNull();
    });

    it('rejects restoring a category that was never deleted', async () => {
      findUnique.mockResolvedValue(category());

      await expect(service.restore('category-1')).rejects.toThrow(ConflictException);
    });
  });
});
