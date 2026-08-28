import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface ProductResponse {
  id: string;
}

interface ProductUnitResponse {
  id: string;
  productId: string;
  serialNumber: string;
  status: 'IN_STOCK' | 'SOLD' | 'RETURNED' | 'DAMAGED';
  product: { id: string; sku: string; trackingType: string };
}

describe('Product Units (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let categoryId: string;
  let serialProductId: string;
  let imeiProductId: string;
  let untrackedProductId: string;

  function sku(suffix: string): string {
    return `${label}-${suffix}`;
  }

  async function createProduct(overrides: Record<string, unknown>): Promise<string> {
    const { sku: skuSuffix, ...rest } = overrides;
    const response = await request(context.server)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku: sku(skuSuffix as string), name: `Product ${String(skuSuffix)}`, categoryId, costPrice: '10.00', sellingPrice: '19.99', ...rest })
      .expect(201);
    return ((response.body as ApiResponse<ProductResponse>).data).id;
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `PU${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      await context.prisma.productUnit.deleteMany({ where: { product: { sku: { startsWith: label } } } });
      await context.prisma.inventory.deleteMany({ where: { product: { sku: { startsWith: label } } } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'pu-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'pu-staff', UserRole.STAFF)).accessToken;

    const category = await request(context.server)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Category` })
      .expect(201);
    categoryId = (category.body as ApiResponse<{ id: string }>).data.id;

    serialProductId = await createProduct({ sku: 'SERIAL1', trackingType: 'SERIAL' });
    imeiProductId = await createProduct({ sku: 'IMEI1', trackingType: 'IMEI' });
    untrackedProductId = await createProduct({ sku: 'NONE1', trackingType: 'NONE' });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('POST /product-units', () => {
    it('registers a serial unit against a SERIAL-tracked product', async () => {
      const response = await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: serialProductId, serialNumber: `${label}-SN-0001` })
        .expect(201);

      const body = response.body as ApiResponse<ProductUnitResponse>;
      expect(body.data.status).toBe('IN_STOCK');
      expect(body.data.serialNumber).toBe(`${label}-SN-0001`);
    });

    it('registers a 15-digit IMEI against an IMEI-tracked product', async () => {
      const response = await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: imeiProductId, serialNumber: '123456789012345' })
        .expect(201);

      expect((response.body as ApiResponse<ProductUnitResponse>).data.serialNumber).toBe('123456789012345');
    });

    it('rejects an IMEI that is not exactly 15 digits', async () => {
      const response = await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: imeiProductId, serialNumber: '1234' })
        .expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('refuses to register a unit for a product with trackingType NONE', async () => {
      const response = await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: untrackedProductId, serialNumber: `${label}-SN-9999` })
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it('refuses a duplicate serial number across the organization', async () => {
      await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: serialProductId, serialNumber: `${label}-SN-DUP` })
        .expect(201);

      const response = await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: serialProductId, serialNumber: `${label}-SN-DUP` })
        .expect(409);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
    });

    it('refuses staff from registering a unit', async () => {
      const response = await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ productId: serialProductId, serialNumber: `${label}-SN-DENIED` })
        .expect(403);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
    });
  });

  describe('GET /product-units/scan/:serialNumber', () => {
    it('finds a unit by its exact serial number, for scanning', async () => {
      await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: serialProductId, serialNumber: `${label}-SN-SCAN` })
        .expect(201);

      const response = await request(context.server)
        .get(`/api/v1/product-units/scan/${label}-SN-SCAN`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect((response.body as ApiResponse<ProductUnitResponse>).data.productId).toBe(serialProductId);
    });

    it('returns 404 for an unknown serial number', async () => {
      const response = await request(context.server)
        .get('/api/v1/product-units/scan/does-not-exist')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(404);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('PATCH /product-units/:id/status', () => {
    it('marks a unit sold', async () => {
      const created = await request(context.server)
        .post('/api/v1/product-units')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId: serialProductId, serialNumber: `${label}-SN-SOLD` })
        .expect(201);
      const unitId = (created.body as ApiResponse<ProductUnitResponse>).data.id;

      const response = await request(context.server)
        .patch(`/api/v1/product-units/${unitId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'SOLD' })
        .expect(200);

      expect((response.body as ApiResponse<ProductUnitResponse>).data.status).toBe('SOLD');
    });
  });
});
