import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { firstCallArg } from '../common/testing/mock-args';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import type { ProductQueryDto } from './dto/product-query.dto';
import { ProductsService } from './products.service';

const CATEGORY_ID = '00000000-0000-4000-8000-000000000001';
const BRAND_ID = '00000000-0000-4000-8000-000000000002';
const CALLER_ID = '00000000-0000-4000-8000-0000000000ff';

function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'product-1',
    sku: 'SPH-AUR-A12',
    barcode: '8901000000011',
    name: 'Aureon A12 128GB',
    description: null,
    categoryId: CATEGORY_ID,
    brandId: BRAND_ID,
    costPrice: '310.00',
    sellingPrice: '429.00',
    minimumStock: 5,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    category: { id: CATEGORY_ID, name: 'Smartphones', slug: 'smartphones' },
    brand: { id: BRAND_ID, name: 'Aureon', slug: 'aureon' },
    inventory: [{ quantity: 0, reservedQuantity: 0, updatedAt: new Date() }],
    ...overrides,
  };
}

function query(overrides: Partial<ProductQueryDto> = {}): ProductQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', includeDeleted: false, ...overrides };
}

const validDto = {
  sku: 'NEW-SKU-1',
  name: 'New Product',
  categoryId: CATEGORY_ID,
  brandId: BRAND_ID,
  costPrice: '10.00',
  sellingPrice: '19.99',
  minimumStock: 3,
  isActive: true,
};

describe('ProductsService', () => {
  let service: ProductsService;
  let productFindUnique: jest.Mock;
  let productFindMany: jest.Mock;
  let productCreate: jest.Mock;
  let productUpdate: jest.Mock;
  let productCount: jest.Mock;
  let inventoryCreate: jest.Mock;
  let categoryFindUnique: jest.Mock;
  let brandFindUnique: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    // The service looks a product up three ways: by sku and barcode to check
    // availability, and by id to read one back. Only the sku/barcode probes
    // should find nothing by default, or every create would report a conflict.
    productFindUnique = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve('organizationId_sku' in args.where || 'organizationId_barcode' in args.where ? null : product()),
    );
    productFindMany = jest.fn(() => Promise.resolve([product()]));
    productCreate = jest.fn(() => Promise.resolve({ id: 'product-1' }));
    productUpdate = jest.fn(() => Promise.resolve(product()));
    productCount = jest.fn(() => Promise.resolve(1));
    inventoryCreate = jest.fn(() => Promise.resolve({}));
    categoryFindUnique = jest.fn(() => Promise.resolve({ deletedAt: null }));
    brandFindUnique = jest.fn(() => Promise.resolve({ deletedAt: null }));

    const client = {
      product: { findUnique: productFindUnique, findMany: productFindMany, create: productCreate, update: productUpdate, count: productCount },
      inventory: { create: inventoryCreate },
      category: { findUnique: categoryFindUnique },
      brand: { findUnique: brandFindUnique },
      location: { findFirstOrThrow: jest.fn(() => Promise.resolve({ id: 'location-1' })) },
    };

    // A callback transaction receives the client; an array form resolves them all.
    transaction = jest.fn((argument: unknown) =>
      typeof argument === 'function' ? (argument as (tx: typeof client) => Promise<unknown>)(client) : Promise.all(argument as Promise<unknown>[]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: TENANT_PRISMA, useValue: { ...client, $transaction: transaction } },
        { provide: AuditService, useValue: { record: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = moduleRef.get(ProductsService);
  });

  function capturedWhere(): Prisma.ProductWhereInput {
    return (firstCallArg(productFindMany) as { where: Prisma.ProductWhereInput }).where;
  }

  describe('findAll', () => {
    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findAll(query());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('loads category, brand and stock with the page rather than per row', async () => {
      await service.findAll(query());

      const { include } = firstCallArg(productFindMany) as { include: Record<string, unknown> };
      expect(Object.keys(include)).toEqual(['category', 'brand', 'inventory']);
    });

    it('returns page metadata alongside the items', async () => {
      productCount.mockResolvedValue(45);

      const result = await service.findAll(query({ page: 2, limit: 20 }));

      expect(result.pagination).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 });
    });

    it('hides soft-deleted products by default', async () => {
      await service.findAll(query());

      expect(capturedWhere().deletedAt).toBeNull();
    });

    it('filters by category, brand and active flag together', async () => {
      await service.findAll(query({ categoryId: CATEGORY_ID, brandId: BRAND_ID, isActive: true }));

      const where = capturedWhere();
      expect(where.categoryId).toBe(CATEGORY_ID);
      expect(where.brandId).toBe(BRAND_ID);
      expect(where.isActive).toBe(true);
    });

    it('filters on an inactive flag rather than treating false as absent', async () => {
      await service.findAll(query({ isActive: false }));

      expect(capturedWhere().isActive).toBe(false);
    });

    it('applies a price range as exact decimal strings', async () => {
      await service.findAll(query({ minPrice: '10.00', maxPrice: '99.99' }));

      expect(capturedWhere().sellingPrice).toEqual({ gte: '10.00', lte: '99.99' });
    });

    it('applies an open-ended price range', async () => {
      await service.findAll(query({ minPrice: '10.00' }));

      expect(capturedWhere().sellingPrice).toEqual({ gte: '10.00' });
    });

    it('searches sku, barcode, name and description', async () => {
      await service.findAll(query({ search: 'aureon' }));

      expect(capturedWhere().AND).toEqual([
        {
          OR: [
            { sku: { contains: 'aureon', mode: 'insensitive' } },
            { barcode: { contains: 'aureon', mode: 'insensitive' } },
            { name: { contains: 'aureon', mode: 'insensitive' } },
            { description: { contains: 'aureon', mode: 'insensitive' } },
          ],
        },
      ]);
    });
  });

  describe('create', () => {
    it('creates the product and its inventory row in one transaction', async () => {
      await service.create(validDto, CALLER_ID);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(productCreate).toHaveBeenCalledTimes(1);
      expect(inventoryCreate).toHaveBeenCalledWith({ data: { organizationId: 'org-1', productId: 'product-1', locationId: 'location-1', quantity: 0 } });
    });

    it('passes money through as an exact string, never a number', async () => {
      await service.create(validDto, CALLER_ID);

      const { data } = firstCallArg(productCreate) as { data: Record<string, unknown> };
      expect(data.costPrice).toBe('10.00');
      expect(data.sellingPrice).toBe('19.99');
      expect(typeof data.costPrice).toBe('string');
    });

    it('normalises absent optional fields to null', async () => {
      await service.create({ ...validDto, barcode: undefined, brandId: undefined }, CALLER_ID);

      const { data } = firstCallArg(productCreate) as { data: Record<string, unknown> };
      expect(data.barcode).toBeNull();
      expect(data.brandId).toBeNull();
    });

    it('rejects a duplicate SKU before opening a transaction', async () => {
      productFindUnique.mockResolvedValue({ id: 'other', deletedAt: null });

      await expect(service.create(validDto, CALLER_ID)).rejects.toThrow(ConflictException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('says so when the SKU belongs to a deleted product', async () => {
      productFindUnique.mockResolvedValue({ id: 'other', deletedAt: new Date() });

      await expect(service.create(validDto, CALLER_ID)).rejects.toThrow(/deleted product/i);
    });

    it.each([
      ['an unknown category', () => categoryFindUnique.mockResolvedValue(null), 'categoryId'],
      ['a deleted category', () => categoryFindUnique.mockResolvedValue({ deletedAt: new Date() }), 'categoryId'],
      ['an unknown brand', () => brandFindUnique.mockResolvedValue(null), 'brandId'],
      ['a deleted brand', () => brandFindUnique.mockResolvedValue({ deletedAt: new Date() }), 'brandId'],
    ])('rejects %s with a pointed field error', async (_label, arrange: () => void, field: string) => {
      productFindUnique.mockResolvedValue(null);
      arrange();

      const error = await service.create(validDto, CALLER_ID).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((error as BadRequestException).getResponse())).toContain(field);
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes only the fields that were supplied', async () => {
      await service.update('product-1', { sellingPrice: '449.00' }, CALLER_ID);

      const { data } = firstCallArg(productUpdate) as { data: Record<string, unknown> };
      expect(data).toEqual({ sellingPrice: '449.00' });
    });

    it('does not re-check a category that was not supplied', async () => {
      await service.update('product-1', { name: 'Renamed' }, CALLER_ID);

      expect(categoryFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes a product that holds no stock', async () => {
      productFindUnique.mockResolvedValue(product({ inventory: [{ quantity: 0, reservedQuantity: 0, updatedAt: new Date() }] }));

      await service.remove('product-1', CALLER_ID);

      const { data } = firstCallArg(productUpdate) as { data: { deletedAt: Date } };
      expect(data.deletedAt).toBeInstanceOf(Date);
    });

    it('refuses to delete a product that still has units on a shelf', async () => {
      productFindUnique.mockResolvedValue(product({ inventory: [{ quantity: 7, reservedQuantity: 0, updatedAt: new Date() }] }));

      await expect(service.remove('product-1', CALLER_ID)).rejects.toThrow(/7 unit\(s\) in stock/);
      expect(productUpdate).not.toHaveBeenCalled();
    });

    it('raises a not-found for a product that is already deleted', async () => {
      productFindUnique.mockResolvedValue(product({ deletedAt: new Date() }));

      await expect(service.remove('product-1', CALLER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    it('clears deletedAt', async () => {
      productFindUnique.mockResolvedValueOnce(product({ deletedAt: new Date() })).mockResolvedValue(product());

      await service.restore('product-1');

      const { data } = firstCallArg(productUpdate) as { data: { deletedAt: Date | null } };
      expect(data.deletedAt).toBeNull();
    });

    it('rejects restoring a product that was never deleted', async () => {
      productFindUnique.mockResolvedValue(product());

      await expect(service.restore('product-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findByBarcode', () => {
    it('returns the product behind a barcode', async () => {
      // Same where-shape as the availability check `create`/`update` use, which defaults to
      // "not found" - this specific lookup needs the opposite, so override just this call.
      productFindUnique.mockResolvedValueOnce(product());

      await expect(service.findByBarcode('8901000000011')).resolves.toMatchObject({ sku: 'SPH-AUR-A12' });
    });

    it('raises a not-found for an unknown barcode', async () => {
      productFindUnique.mockResolvedValue(null);

      await expect(service.findByBarcode('nope')).rejects.toThrow(NotFoundException);
    });

    it('does not resolve a barcode to a deleted product', async () => {
      productFindUnique.mockResolvedValue(product({ deletedAt: new Date() }));

      await expect(service.findByBarcode('8901000000011')).rejects.toThrow(NotFoundException);
    });
  });
});
