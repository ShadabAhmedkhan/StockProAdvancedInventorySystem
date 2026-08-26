import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

/**
 * `registerUser`/`signInAs` each create a brand-new organization (Phase 31's
 * registration rewrite), so two independent calls give two independent
 * tenants for free - no separate "create org" step needed.
 *
 * This is the load-bearing test for the whole multi-tenant conversion: every
 * cross-org read/update/delete attempt below must come back 404, never 403 -
 * a 403 would mean the row was found and access was refused; 404 is what the
 * Prisma extension's injected `organizationId` filter actually produces, the
 * row simply does not exist from the other org's point of view.
 */
describe('Tenant isolation (e2e)', () => {
  let context: TestApp;
  let label: string;
  let orgAToken: string;
  let orgBToken: string;

  /** Entity codes must look like `PREFIX-SUFFIX`; other names are just prefixed. */
  function code(suffix: string): string {
    return `${label}-${suffix}`;
  }

  function name(suffix: string): string {
    return `${label}${suffix}`;
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `TI${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };
      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });
      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
      await context.prisma.brand.deleteMany({ where: { name: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: label } } });
      await context.prisma.setting.deleteMany({ where: { key: { startsWith: label } } });
    });

    orgAToken = (await signInAs(context, 'tenant-a-admin', UserRole.ADMIN)).accessToken;
    orgBToken = (await signInAs(context, 'tenant-b-admin', UserRole.ADMIN)).accessToken;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('customers', () => {
    it('is invisible to another org: 404 on direct fetch, absent from the list, independently creatable with the same code', async () => {
      const created = await request(context.server)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ customerCode: code('CUST'), firstName: 'Org', lastName: 'A', phone: '+15550100' })
        .expect(201);
      const customerId = body<Identified>(created).id;

      // Org A can still read its own record.
      await request(context.server).get(`/api/v1/customers/${customerId}`).set('Authorization', `Bearer ${orgAToken}`).expect(200);

      // Org B cannot reach it by known id - 404, not 403.
      const fetchAsB = await request(context.server).get(`/api/v1/customers/${customerId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);
      expect((fetchAsB.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);

      // Org B cannot update or delete it either.
      await request(context.server)
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ phone: '+15559999' })
        .expect(404);
      await request(context.server).delete(`/api/v1/customers/${customerId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);

      // Org B's list never includes Org A's row.
      const listAsB = await request(context.server).get(`/api/v1/customers?search=${label}`).set('Authorization', `Bearer ${orgBToken}`).expect(200);
      expect(body<{ id: string }[]>(listAsB)).toHaveLength(0);

      // The same customerCode is free for Org B, because the unique
      // constraint is scoped per-organization.
      const createdByB = await request(context.server)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ customerCode: code('CUST'), firstName: 'Org', lastName: 'B', phone: '+15550200' })
        .expect(201);
      expect(body<Identified>(createdByB).id).not.toBe(customerId);
    });
  });

  describe('suppliers', () => {
    it('is invisible to another org', async () => {
      const created = await request(context.server)
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ supplierCode: code('SUP'), name: 'Org A Supplier', phone: '+15550101' })
        .expect(201);
      const supplierId = body<Identified>(created).id;

      await request(context.server).get(`/api/v1/suppliers/${supplierId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);

      const listAsB = await request(context.server).get(`/api/v1/suppliers?search=${label}`).set('Authorization', `Bearer ${orgBToken}`).expect(200);
      expect(body<{ id: string }[]>(listAsB)).toHaveLength(0);
    });
  });

  describe('categories and products', () => {
    it('is invisible to another org, including the product stock endpoints', async () => {
      const category = await request(context.server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ name: name('Category') })
        .expect(201);
      const categoryId = body<Identified>(category).id;

      const product = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ sku: name('SKU'), name: 'Org A Product', categoryId, costPrice: '1.00', sellingPrice: '2.00' })
        .expect(201);
      const productId = body<Identified>(product).id;

      await request(context.server)
        .post('/api/v1/stock/adjust')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ productId, type: StockMovementType.PURCHASE, quantity: 10 })
        .expect(200);

      // Org B cannot see the category, the product, or its stock level.
      await request(context.server).get(`/api/v1/categories/${categoryId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);
      await request(context.server).get(`/api/v1/products/${productId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);
      await request(context.server).get(`/api/v1/stock/${productId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);

      // Nor can Org B adjust stock it cannot see - the raw-SQL guard added in
      // Phase 32, exercised end to end here.
      const adjustAsB = await request(context.server)
        .post('/api/v1/stock/adjust')
        .set('Authorization', `Bearer ${orgBToken}`)
        .send({ productId, type: StockMovementType.PURCHASE, quantity: 5 })
        .expect(404);
      expect((adjustAsB.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);

      // Org A's stock is unaffected by Org B's attempt.
      const stockAsA = await request(context.server).get(`/api/v1/stock/${productId}`).set('Authorization', `Bearer ${orgAToken}`).expect(200);
      expect(body<{ quantity: number }>(stockAsA).quantity).toBe(10);
    });
  });

  describe('orders', () => {
    it('is invisible to another org, and reports never mix figures across orgs', async () => {
      const category = await request(context.server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ name: name('OrderCategory') })
        .expect(201);
      const categoryId = body<Identified>(category).id;

      const product = await request(context.server)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ sku: name('ORDSKU'), name: 'Org A Order Product', categoryId, costPrice: '1.00', sellingPrice: '50.00' })
        .expect(201);
      const productId = body<Identified>(product).id;

      await request(context.server)
        .post('/api/v1/stock/adjust')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ productId, type: StockMovementType.PURCHASE, quantity: 5 })
        .expect(200);

      const order = await request(context.server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ items: [{ productId, quantity: 1 }] })
        .expect(201);
      const orderId = body<Identified>(order).id;

      await request(context.server).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);

      const listAsB = await request(context.server).get('/api/v1/orders').set('Authorization', `Bearer ${orgBToken}`).expect(200);
      expect(body<{ id: string }[]>(listAsB).some((row) => row.id === orderId)).toBe(false);

      // Org B's top-products report - a raw $queryRaw query, Phase 32's
      // primary fix - never surfaces Org A's product.
      const topProductsAsB = await request(context.server).get('/api/v1/reports/top-products').set('Authorization', `Bearer ${orgBToken}`).expect(200);
      expect(body<{ productId: string }[]>(topProductsAsB).some((row) => row.productId === productId)).toBe(false);
    });
  });

  describe('settings', () => {
    it('is invisible to another org', async () => {
      await request(context.server)
        .put(`/api/v1/settings/${name('key')}`)
        .set('Authorization', `Bearer ${orgAToken}`)
        .send({ value: 'org-a-value' })
        .expect(200);

      const readAsB = await request(context.server).get(`/api/v1/settings/${name('key')}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);
      expect((readAsB.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  it('lets Org B use ids that only look like collisions - a fresh random id is 404 for both orgs', async () => {
    const unknownId = randomUUID();
    await request(context.server).get(`/api/v1/customers/${unknownId}`).set('Authorization', `Bearer ${orgAToken}`).expect(404);
    await request(context.server).get(`/api/v1/customers/${unknownId}`).set('Authorization', `Bearer ${orgBToken}`).expect(404);
  });
});
