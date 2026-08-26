import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

/** The API shape of a product, with money as exact decimal strings. */
interface ProductResponse {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string;
  brandId: string | null;
  costPrice: string;
  sellingPrice: string;
  minimumStock: number;
  isActive: boolean;
  deletedAt: string | null;
  category: { id: string; name: string; slug: string };
  brand: { id: string; name: string; slug: string } | null;
  inventory: { quantity: number; reservedQuantity: number } | null;
}

describe('Products (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let categoryId: string;
  let brandId: string;

  function sku(suffix: string): string {
    return `${label}-${suffix}`;
  }

  async function createProduct(token: string, body: Record<string, unknown>): Promise<ApiResponse<ProductResponse>> {
    const response = await request(context.server).post('/api/v1/products').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    return response.body as ApiResponse<ProductResponse>;
  }

  function baseProduct(suffix: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { sku: sku(suffix), name: `Product ${suffix}`, categoryId, costPrice: '10.00', sellingPrice: '19.99', ...overrides };
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `P${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      await context.prisma.auditLog.deleteMany({ where: { userId: { in: context.createdUserIds } } });
      await context.prisma.inventory.deleteMany({ where: { product: { sku: { startsWith: label } } } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
      await context.prisma.brand.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'prod-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'prod-staff', UserRole.STAFF)).accessToken;

    const category = await request(context.server)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Test Category` })
      .expect(201);
    categoryId = (category.body as ApiResponse<{ id: string }>).data.id;

    const brand = await request(context.server)
      .post('/api/v1/brands')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Test Brand` })
      .expect(201);
    brandId = (brand.body as ApiResponse<{ id: string }>).data.id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('access control', () => {
    it('lets any authenticated user read the catalogue', async () => {
      await request(context.server).get('/api/v1/products').set('Authorization', `Bearer ${staffToken}`).expect(200);
    });

    it('refuses staff from creating a product, because the record carries pricing', async () => {
      const response = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(baseProduct('DENIED'))
        .expect(403);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
    });
  });

  describe('POST /products', () => {
    it('creates a product together with its inventory record at zero', async () => {
      const body = await createProduct(adminToken, baseProduct('NEW1', { brandId, barcode: `${label}-BC-1`, minimumStock: 5 }));

      expect(body.data.sku).toBe(sku('NEW1'));
      expect(body.data.inventory).toEqual({ quantity: 0, reservedQuantity: 0, updatedAt: expect.any(String) as string });
      expect(body.data.category.id).toBe(categoryId);
      expect(body.data.brand?.id).toBe(brandId);
      expect(body.data.isActive).toBe(true);
      expect(body.data.minimumStock).toBe(5);
    });

    it('writes no stock movement, because nothing has moved', async () => {
      const body = await createProduct(adminToken, baseProduct('NOMOVE'));

      const movements = await context.prisma.stockMovement.count({ where: { productId: body.data.id } });
      expect(movements).toBe(0);
    });

    it('upper-cases the SKU so one product cannot become two', async () => {
      const body = await createProduct(adminToken, baseProduct('CASE', { sku: sku('case').toLowerCase() }));

      expect(body.data.sku).toBe(sku('CASE'));
    });

    it('returns money as exact two-decimal strings, never as JSON numbers', async () => {
      const body = await createProduct(adminToken, baseProduct('MONEY', { costPrice: '1.05', sellingPrice: '429.00' }));

      expect(body.data.costPrice).toBe('1.05');
      // 429.00 must not arrive as "429" or as the number 429.
      expect(body.data.sellingPrice).toBe('429.00');
      expect(typeof body.data.sellingPrice).toBe('string');
    });

    it('accepts a JSON number and stores it exactly', async () => {
      const body = await createProduct(adminToken, baseProduct('NUM', { costPrice: 12.5, sellingPrice: 19.99 }));

      expect(body.data.costPrice).toBe('12.50');
      expect(body.data.sellingPrice).toBe('19.99');
    });

    it('rejects a duplicate SKU', async () => {
      await createProduct(adminToken, baseProduct('DUP'));

      const response = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(baseProduct('DUP', { name: 'Second' }))
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it('rejects a duplicate barcode', async () => {
      await createProduct(adminToken, baseProduct('BC1', { barcode: `${label}-SHARED` }));

      await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(baseProduct('BC2', { barcode: `${label}-SHARED` }))
        .expect(409);
    });

    it.each([
      ['a negative price', { sellingPrice: '-1.00' }, 'sellingPrice'],
      ['three decimal places', { sellingPrice: '19.999' }, 'sellingPrice'],
      ['a price that is not a number', { costPrice: 'free' }, 'costPrice'],
      ['a lower-case SKU with punctuation', { sku: 'not a sku!' }, 'sku'],
      ['a blank name', { name: '' }, 'name'],
      ['a negative minimum stock', { minimumStock: -1 }, 'minimumStock'],
      ['a category that is not a UUID', { categoryId: 'nope' }, 'categoryId'],
    ])('rejects %s', async (_label, override: Record<string, unknown>, field: string) => {
      const response = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(baseProduct('VALID', override))
        .expect(400);

      const body = response.body as ApiErrorResponse;
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.errors?.map((error) => error.field)).toContain(field);
    });

    it('rejects a category that does not exist, naming the field', async () => {
      const response = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(baseProduct('NOCAT', { categoryId: randomUUID() }))
        .expect(400);

      expect((response.body as ApiErrorResponse).errors?.map((error) => error.field)).toContain('categoryId');
    });

    it('rejects an unknown property rather than silently dropping it', async () => {
      await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(baseProduct('EXTRA', { quantity: 100 }))
        .expect(400);
    });
  });

  describe('GET /products', () => {
    it('returns a page with relations loaded and page metadata in the envelope', async () => {
      const response = await request(context.server).get(`/api/v1/products?search=${label}&limit=3`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const body = response.body as ApiResponse<ProductResponse[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row) => row.category.name.length > 0)).toBe(true);
      expect(body.data.every((row) => row.inventory !== null)).toBe(true);
      expect(body.meta.limit).toBe(3);
      expect(body.meta.totalPages).toBe(Math.ceil((body.meta.total ?? 0) / 3));
    });

    it('filters by category and brand', async () => {
      const response = await request(context.server)
        .get(`/api/v1/products?categoryId=${categoryId}&brandId=${brandId}&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<ProductResponse[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row) => row.categoryId === categoryId && row.brandId === brandId)).toBe(true);
    });

    it('filters by the active flag', async () => {
      await createProduct(adminToken, baseProduct('INACTIVE', { isActive: false }));

      const response = await request(context.server)
        .get(`/api/v1/products?search=${label}&isActive=false&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<ProductResponse[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row) => !row.isActive)).toBe(true);
    });

    it('filters by a selling-price range', async () => {
      await createProduct(adminToken, baseProduct('CHEAP', { sellingPrice: '5.00' }));
      await createProduct(adminToken, baseProduct('PRICEY', { sellingPrice: '5000.00' }));

      const response = await request(context.server)
        .get(`/api/v1/products?search=${label}&minPrice=1000.00&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<ProductResponse[]>;

      expect(body.data.some((row) => row.sku === sku('PRICEY'))).toBe(true);
      expect(body.data.some((row) => row.sku === sku('CHEAP'))).toBe(false);
    });

    it('sorts by price on the server, comparing numbers rather than strings', async () => {
      const response = await request(context.server)
        .get(`/api/v1/products?search=${label}&sortBy=sellingPrice&sortOrder=asc&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const prices = (response.body as ApiResponse<ProductResponse[]>).data.map((row) => Number(row.sellingPrice));

      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it.each([
      ['an unlisted sort column', 'sortBy=costPriceSecret'],
      ['a malformed price filter', 'minPrice=cheap'],
      ['a category filter that is not a UUID', 'categoryId=nope'],
      ['a limit above the cap', 'limit=1000'],
    ])('rejects %s', async (_label, queryString: string) => {
      const response = await request(context.server).get(`/api/v1/products?${queryString}`).set('Authorization', `Bearer ${adminToken}`).expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe('GET /products/barcode/:barcode', () => {
    it('finds a product by its barcode', async () => {
      await createProduct(adminToken, baseProduct('SCAN', { barcode: `${label}-SCANME` }));

      const response = await request(context.server).get(`/api/v1/products/barcode/${label}-SCANME`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect((response.body as ApiResponse<ProductResponse>).data.sku).toBe(sku('SCAN'));
    });

    it('returns 404 for an unknown barcode', async () => {
      const response = await request(context.server).get('/api/v1/products/barcode/0000000000000').set('Authorization', `Bearer ${adminToken}`).expect(404);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);
    });

    it('does not shadow the :id route', async () => {
      const created = await createProduct(adminToken, baseProduct('BOTH'));

      await request(context.server).get(`/api/v1/products/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    });
  });

  describe('PATCH /products/:id', () => {
    it('updates only the supplied fields and keeps money exact', async () => {
      const created = await createProduct(adminToken, baseProduct('UPD', { brandId }));

      const response = await request(context.server)
        .patch(`/api/v1/products/${created.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sellingPrice: '24.50' })
        .expect(200);
      const body = response.body as ApiResponse<ProductResponse>;

      expect(body.data.sellingPrice).toBe('24.50');
      expect(body.data.costPrice).toBe('10.00');
      expect(body.data.name).toBe('Product UPD');
      expect(body.data.brand?.id).toBe(brandId);
    });

    it('deactivates a product without deleting it', async () => {
      const created = await createProduct(adminToken, baseProduct('DEACT'));

      const response = await request(context.server)
        .patch(`/api/v1/products/${created.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false })
        .expect(200);
      const body = response.body as ApiResponse<ProductResponse>;

      expect(body.data.isActive).toBe(false);
      expect(body.data.deletedAt).toBeNull();
    });

    it('rejects a stock quantity, because stock changes belong to the ledger', async () => {
      const created = await createProduct(adminToken, baseProduct('NOSTOCK'));

      await request(context.server)
        .patch(`/api/v1/products/${created.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 50 })
        .expect(400);
    });
  });

  describe('delete and restore', () => {
    it('soft-deletes a product that holds no stock, and restores it', async () => {
      const created = await createProduct(adminToken, baseProduct('CYCLE'));

      await request(context.server).delete(`/api/v1/products/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      await request(context.server).get(`/api/v1/products/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(404);

      // The row and its inventory survive, so history stays reconcilable.
      const stillStored = await context.prisma.product.findUnique({ where: { id: created.data.id }, include: { inventory: true } });
      expect(stillStored?.inventory).not.toBeNull();

      await request(context.server).post(`/api/v1/products/${created.data.id}/restore`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      await request(context.server).get(`/api/v1/products/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    });

    it('refuses to delete a product that still has units on a shelf', async () => {
      const created = await createProduct(adminToken, baseProduct('HASSTOCK'));
      await context.prisma.inventory.update({ where: { productId: created.data.id }, data: { quantity: 7 } });

      const response = await request(context.server).delete(`/api/v1/products/${created.data.id}`).set('Authorization', `Bearer ${adminToken}`).expect(409);

      expect((response.body as ApiErrorResponse).message).toMatch(/7 unit\(s\) in stock/);

      await context.prisma.inventory.update({ where: { productId: created.data.id }, data: { quantity: 0 } });
    });

    it('refuses to restore a product that was never deleted', async () => {
      const created = await createProduct(adminToken, baseProduct('LIVE'));

      await request(context.server).post(`/api/v1/products/${created.data.id}/restore`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    });
  });

  describe('money representation across the whole catalogue', () => {
    it('formats a price with no exact binary representation as an exact two-decimal string', async () => {
      await createProduct(adminToken, baseProduct('GLS', { costPrice: '1.05', sellingPrice: '7.50' }));

      const response = await request(context.server)
        .get(`/api/v1/products?search=${sku('GLS')}&limit=10`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<ProductResponse[]>;
      const glass = body.data.find((row) => row.sku === sku('GLS'));

      // 1.05 has no exact binary representation; it must survive untouched.
      expect(glass?.costPrice).toBe('1.05');
      expect(glass?.sellingPrice).toBe('7.50');
      expect(response.text).not.toContain('"sellingPrice":7.5');
    });
  });
});
