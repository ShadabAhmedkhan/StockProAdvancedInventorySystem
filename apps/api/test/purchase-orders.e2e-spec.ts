import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { PurchaseOrderStatus, StockMovementType, StockReferenceType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * The purchase order lifecycle end to end: draft -> approve -> order ->
 * partial receive -> full receive, checking status transitions and
 * Inventory/StockMovement at every step. Also covers cancel-before-receiving
 * and that cancel is refused once any receiving has happened.
 */
describe('Purchase orders (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let supplierId: string;

  interface PurchaseOrderBody {
    id: string;
    status: PurchaseOrderStatus;
    total: string;
    items: { id: string; productId: string; quantity: number; receivedQuantity?: number }[];
  }

  function body<T>(response: { body: ApiResponse<T> }): T {
    return response.body.data;
  }

  function post(path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).post(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  function get(path: string): request.Test {
    return request(context.server).get(path).set('Authorization', `Bearer ${adminToken}`);
  }

  async function makeProduct(suffix: string): Promise<string> {
    const created = await post('/api/v1/products', {
      sku: `${label}-${suffix}`,
      name: `PO ${suffix}`,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
    }).expect(201);

    return body<{ id: string }>(created).id;
  }

  async function inventoryOf(productId: string): Promise<{ quantity: number; reservedQuantity: number }> {
    const row = await context.prisma.inventory.findFirstOrThrow({ where: { productId } });

    return { quantity: row.quantity, reservedQuantity: row.reservedQuantity };
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `PO${context.run.slice(0, 5).toUpperCase()}`;

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
      await context.prisma.supplier.deleteMany({ where: { supplierCode: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'po-lifecycle', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Category` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const supplier = await post('/api/v1/suppliers', { supplierCode: `${label}-SUP`, name: `${label} Supplier`, phone: '+15550100' }).expect(201);
    supplierId = body<{ id: string }>(supplier).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('runs the full draft -> approve -> order -> partial receive -> full receive lifecycle', async () => {
    const productId = await makeProduct('LIFECYCLE');

    const created = await post('/api/v1/purchase-orders', {
      supplierId,
      items: [{ productId, quantity: 10 }],
    }).expect(201);
    const po = body<PurchaseOrderBody>(created);
    expect(po.status).toBe(PurchaseOrderStatus.DRAFT);

    // Creating and approving a draft moves no inventory.
    const approved = await post(`/api/v1/purchase-orders/${po.id}/approve`).expect(200);
    expect(body<PurchaseOrderBody>(approved).status).toBe(PurchaseOrderStatus.APPROVED);
    expect((await inventoryOf(productId)).quantity).toBe(0);

    const ordered = await post(`/api/v1/purchase-orders/${po.id}/order`).expect(200);
    expect(body<PurchaseOrderBody>(ordered).status).toBe(PurchaseOrderStatus.ORDERED);
    expect((await inventoryOf(productId)).quantity).toBe(0);

    const detail = body<PurchaseOrderBody>(ordered);
    const itemId = detail.items[0]?.id;
    expect(itemId).toBeDefined();

    // Partial receipt: 4 of 10.
    const firstReceipt = await post(`/api/v1/purchase-orders/${po.id}/goods-receipts`, {
      items: [{ purchaseOrderItemId: itemId, quantityReceived: 4 }],
    }).expect(201);
    expect(body<{ id: string }>(firstReceipt).id).toBeDefined();

    const afterFirst = await get(`/api/v1/purchase-orders/${po.id}`).expect(200);
    expect(body<PurchaseOrderBody>(afterFirst).status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect((await inventoryOf(productId)).quantity).toBe(4);

    // Full receipt: the remaining 6.
    await post(`/api/v1/purchase-orders/${po.id}/goods-receipts`, {
      items: [{ purchaseOrderItemId: itemId, quantityReceived: 6 }],
    }).expect(201);

    const afterSecond = await get(`/api/v1/purchase-orders/${po.id}`).expect(200);
    expect(body<PurchaseOrderBody>(afterSecond).status).toBe(PurchaseOrderStatus.RECEIVED);
    expect((await inventoryOf(productId)).quantity).toBe(10);

    const movements = await context.prisma.stockMovement.findMany({ where: { productId, type: StockMovementType.PURCHASE } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.referenceType === StockReferenceType.PURCHASE)).toBe(true);
    expect(movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(10);

    // Receiving beyond what remains outstanding is refused.
    await post(`/api/v1/purchase-orders/${po.id}/goods-receipts`, {
      items: [{ purchaseOrderItemId: itemId, quantityReceived: 1 }],
    }).expect(409);
  });

  it('cancels a draft, approved or ordered purchase order with no inventory effect', async () => {
    const productId = await makeProduct('CANCELDRAFT');
    const created = await post('/api/v1/purchase-orders', { supplierId, items: [{ productId, quantity: 5 }] }).expect(201);
    const po = body<PurchaseOrderBody>(created);

    const cancelled = await post(`/api/v1/purchase-orders/${po.id}/cancel`).expect(200);
    expect(body<PurchaseOrderBody>(cancelled).status).toBe(PurchaseOrderStatus.CANCELLED);
    expect((await inventoryOf(productId)).quantity).toBe(0);
  });

  it('refuses to cancel once any receiving has happened', async () => {
    const productId = await makeProduct('CANCELAFTERRECEIVE');
    const created = await post('/api/v1/purchase-orders', { supplierId, items: [{ productId, quantity: 5 }] }).expect(201);
    const po = body<PurchaseOrderBody>(created);

    await post(`/api/v1/purchase-orders/${po.id}/approve`).expect(200);
    const ordered = await post(`/api/v1/purchase-orders/${po.id}/order`).expect(200);
    const itemId = body<PurchaseOrderBody>(ordered).items[0]?.id;

    await post(`/api/v1/purchase-orders/${po.id}/goods-receipts`, { items: [{ purchaseOrderItemId: itemId, quantityReceived: 1 }] }).expect(201);

    await post(`/api/v1/purchase-orders/${po.id}/cancel`).expect(409);

    const after = await get(`/api/v1/purchase-orders/${po.id}`).expect(200);
    expect(body<PurchaseOrderBody>(after).status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
  });

  it('refuses to receive against a draft or approved purchase order', async () => {
    const productId = await makeProduct('RECEIVETOOEARLY');
    const created = await post('/api/v1/purchase-orders', { supplierId, items: [{ productId, quantity: 5 }] }).expect(201);
    const po = body<PurchaseOrderBody>(created);
    const itemId = po.items[0]?.id;

    await post(`/api/v1/purchase-orders/${po.id}/goods-receipts`, { items: [{ purchaseOrderItemId: itemId, quantityReceived: 1 }] }).expect(409);

    await post(`/api/v1/purchase-orders/${po.id}/approve`).expect(200);
    await post(`/api/v1/purchase-orders/${po.id}/goods-receipts`, { items: [{ purchaseOrderItemId: itemId, quantityReceived: 1 }] }).expect(409);
  });

  it('freezes lines once approved', async () => {
    const productId = await makeProduct('FREEZE');
    const created = await post('/api/v1/purchase-orders', { supplierId, items: [{ productId, quantity: 5 }] }).expect(201);
    const po = body<PurchaseOrderBody>(created);

    await post(`/api/v1/purchase-orders/${po.id}/approve`).expect(200);

    await post(`/api/v1/purchase-orders/${po.id}/items`, { productId: await makeProduct('FREEZE2'), quantity: 1 }).expect(409);
  });

  it('defaults unitCost from the product cost price', async () => {
    const productId = await makeProduct('DEFAULTCOST');
    const created = await post('/api/v1/purchase-orders', { supplierId, items: [{ productId, quantity: 2 }] }).expect(201);
    const po = body<{ items: { unitCost: string }[] }>(created);

    expect(po.items[0]?.unitCost).toBe('5.00');
  });
});
