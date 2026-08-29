import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

interface ReorderSuggestion {
  productId: string;
  sku: string;
  quantity: number;
  reservedQuantity: number;
  availableStock: number;
  incomingStock: number;
  averageDailyDemand: string;
  reorderPoint: number;
  targetStock: number;
  safetyStock: number;
  leadTimeDays: number | null;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  suggestedReorderQuantity: number;
}

/**
 * Reorder suggestions are pure arithmetic over stock already exercised by
 * other suites (available/reserved/incoming/target) - this spec checks the
 * formula end to end against real Inventory/PurchaseOrder rows rather than
 * unit-testing the SQL in isolation.
 */
describe('Reorder suggestions (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let supplierId: string;

  function body<T>(response: { body: ApiResponse<T> }): T {
    return response.body.data;
  }

  function post(path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).post(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  function patch(path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).patch(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  function get(path: string): request.Test {
    return request(context.server).get(path).set('Authorization', `Bearer ${adminToken}`);
  }

  async function makeProduct(suffix: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const created = await post('/api/v1/products', {
      sku: `${label}-${suffix}`,
      name: `Reorder ${suffix}`,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
      ...overrides,
    }).expect(201);

    return body<{ id: string }>(created).id;
  }

  async function stockUp(productId: string, quantity: number): Promise<void> {
    await post('/api/v1/stock/adjust', { productId, type: 'ADJUSTMENT_IN', quantity, note: 'Seed for reorder test' }).expect(200);
  }

  /** Puts `outstanding` units of incoming stock on an ORDERED purchase order for this product. */
  async function orderIncoming(productId: string, outstanding: number): Promise<void> {
    const created = await post('/api/v1/purchase-orders', { supplierId, items: [{ productId, quantity: outstanding }] }).expect(201);
    const poId = body<{ id: string }>(created).id;
    await post(`/api/v1/purchase-orders/${poId}/approve`).expect(200);
    await post(`/api/v1/purchase-orders/${poId}/order`).expect(200);
  }

  async function suggestionFor(productId: string, needsReorderOnly = false): Promise<ReorderSuggestion | undefined> {
    const response = await get(`/api/v1/stock/reorder-suggestions?limit=100&needsReorderOnly=${String(needsReorderOnly)}`).expect(200);
    return body<ReorderSuggestion[]>(response).find((item) => item.productId === productId);
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `RO${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });
      await context.prisma.goodsReceiptItem.deleteMany({ where: { goodsReceipt: { createdById } } });
      await context.prisma.goodsReceipt.deleteMany({ where: { createdById } });
      await context.prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { createdById } } });
      await context.prisma.purchaseOrder.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
      await context.prisma.supplier.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'reorder-lifecycle', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Category` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const supplier = await post('/api/v1/suppliers', { supplierCode: `${label}-SUP`, name: `${label} Supplier`, phone: '+1 555 0100' }).expect(201);
    supplierId = body<{ id: string }>(supplier).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('excludes a product with no reorderPoint configured', async () => {
    const productId = await makeProduct('NOPOLICY');
    await stockUp(productId, 1);

    const suggestion = await suggestionFor(productId);
    expect(suggestion).toBeUndefined();
  });

  it('suggests a quantity that brings stock up to target, netting off incoming stock', async () => {
    const productId = await makeProduct('CALC', { reorderPoint: 10, targetStock: 30, safetyStock: 5, supplierLeadTimeDays: 7 });
    await stockUp(productId, 6);
    await orderIncoming(productId, 4);

    // available=6, incoming=4 -> projected=10 <= reorderPoint(10) -> suggested = target(30) - projected(10) = 20.
    const suggestion = await suggestionFor(productId);
    expect(suggestion).toBeDefined();
    expect(suggestion?.availableStock).toBe(6);
    expect(suggestion?.incomingStock).toBe(4);
    expect(suggestion?.targetStock).toBe(30);
    expect(suggestion?.suggestedReorderQuantity).toBe(20);
    expect(suggestion?.leadTimeDays).toBe(7);
  });

  it('suggests nothing once projected stock clears the reorder point', async () => {
    const productId = await makeProduct('CLEAR', { reorderPoint: 5, targetStock: 20 });
    await stockUp(productId, 12);

    const suggestion = await suggestionFor(productId);
    expect(suggestion?.suggestedReorderQuantity).toBe(0);
  });

  it('falls back to reorderPoint + safetyStock when targetStock is unset', async () => {
    const productId = await makeProduct('DEFAULTTARGET', { reorderPoint: 8, safetyStock: 3 });
    await stockUp(productId, 2);

    // available=2, incoming=0 -> projected=2 <= 8 -> target defaults to 8+3=11 -> suggested = 11-2 = 9.
    const suggestion = await suggestionFor(productId);
    expect(suggestion?.targetStock).toBe(11);
    expect(suggestion?.suggestedReorderQuantity).toBe(9);
  });

  it('needsReorderOnly hides products that do not need reordering', async () => {
    const productId = await makeProduct('HIDDEN', { reorderPoint: 5, targetStock: 20 });
    await stockUp(productId, 50);

    const hidden = await suggestionFor(productId, true);
    expect(hidden).toBeUndefined();

    const shown = await suggestionFor(productId, false);
    expect(shown).toBeDefined();
  });

  it('carries the preferred supplier through to the suggestion', async () => {
    const productId = await makeProduct('SUPPLIER', { reorderPoint: 5, targetStock: 15, preferredSupplierId: supplierId });
    await stockUp(productId, 1);

    const suggestion = await suggestionFor(productId);
    expect(suggestion?.preferredSupplierId).toBe(supplierId);
    expect(suggestion?.preferredSupplierName).toBe(`${label} Supplier`);
  });

  it('rejects a reorderPoint update that references a deleted supplier context correctly (preferredSupplierId must exist)', async () => {
    const response = await post('/api/v1/products', {
      sku: `${label}-BADSUP`,
      name: 'Bad supplier ref',
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
      preferredSupplierId: '00000000-0000-4000-8000-000000000000',
    }).expect(400);

    expect((response.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('lets an existing product have its reorder policy patched in later', async () => {
    const productId = await makeProduct('PATCHED');
    await stockUp(productId, 3);

    expect(await suggestionFor(productId)).toBeUndefined();

    await patch(`/api/v1/products/${productId}`, { reorderPoint: 5, targetStock: 15 }).expect(200);

    const suggestion = await suggestionFor(productId);
    expect(suggestion?.suggestedReorderQuantity).toBe(12);
  });
});
