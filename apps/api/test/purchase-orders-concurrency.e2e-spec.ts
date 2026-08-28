import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { PurchaseOrderStatus, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * Two simultaneous goods receipts racing to receive more than a purchase
 * order line's outstanding quantity must not both succeed: the conditional
 * UPDATE on `PurchaseOrderItem.receivedQuantity` (the same pattern as
 * `Inventory.reservedQuantity`) is what stops that. Mirrors the structure of
 * orders-concurrency.e2e-spec.ts.
 */
describe('Purchase orders concurrency (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let supplierId: string;

  interface PurchaseOrderBody {
    id: string;
    status: PurchaseOrderStatus;
    items: { id: string; productId: string }[];
  }

  function body<T>(response: { body: ApiResponse<T> }): T {
    return response.body.data;
  }

  function post(path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).post(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  async function orderedPurchaseOrder(suffix: string, quantity: number): Promise<{ purchaseOrderId: string; itemId: string; productId: string }> {
    const product = await post('/api/v1/products', {
      sku: `${label}-${suffix}`,
      name: `Race ${suffix}`,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
    }).expect(201);
    const productId = body<{ id: string }>(product).id;

    const created = await post('/api/v1/purchase-orders', { supplierId, items: [{ productId, quantity }] }).expect(201);
    const po = body<PurchaseOrderBody>(created);

    await post(`/api/v1/purchase-orders/${po.id}/approve`).expect(200);
    const ordered = await post(`/api/v1/purchase-orders/${po.id}/order`).expect(200);
    const orderedBody = body<PurchaseOrderBody>(ordered);
    const itemId = orderedBody.items[0]?.id;

    if (itemId === undefined) {
      throw new Error('purchase order line missing');
    }

    return { purchaseOrderId: po.id, itemId, productId };
  }

  function tally(statuses: number[]): { ok: number; conflict: number; other: number[] } {
    return {
      ok: statuses.filter((status) => status === 201).length,
      conflict: statuses.filter((status) => status === 409).length,
      other: statuses.filter((status) => status !== 201 && status !== 409),
    };
  }

  beforeAll(async () => {
    context = await createTestApp({ throttleLimit: 10_000 });
    label = `POC${context.run.slice(0, 5).toUpperCase()}`;

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

    adminToken = (await signInAs(context, 'po-race', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Race Category` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const supplier = await post('/api/v1/suppliers', { supplierCode: `${label}-SUP`, name: `${label} Supplier`, phone: '+15550200' }).expect(201);
    supplierId = body<{ id: string }>(supplier).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('lets only as many receipts through as the line has outstanding', async () => {
    // 10 ordered, 6 attempts of 3 each = 18 requested against 10 outstanding:
    // exactly 3 can succeed (9 received), the 4th always overshoots.
    const { purchaseOrderId, itemId, productId } = await orderedPurchaseOrder('SPLIT', 10);

    const settled = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(`/api/v1/purchase-orders/${purchaseOrderId}/goods-receipts`, { items: [{ purchaseOrderItemId: itemId, quantityReceived: 3 }] }),
      ),
    );
    const result = tally(settled.map((response) => response.status));

    expect(result.other).toEqual([]);
    expect(result.ok).toBe(3);
    expect(result.conflict).toBe(3);

    const item = await context.prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.receivedQuantity).toBe(9);
    expect(item.receivedQuantity).toBeLessThanOrEqual(item.quantity);

    const inventory = await context.prisma.inventory.findFirstOrThrow({ where: { productId } });
    expect(inventory.quantity).toBe(9);

    const movements = await context.prisma.stockMovement.findMany({ where: { productId } });
    expect(movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(9);
  });

  it('receives exactly once when the same delivery is submitted twice at the same moment', async () => {
    const { purchaseOrderId, itemId, productId } = await orderedPurchaseOrder('DOUBLE', 5);

    const settled = await Promise.all([
      post(`/api/v1/purchase-orders/${purchaseOrderId}/goods-receipts`, { items: [{ purchaseOrderItemId: itemId, quantityReceived: 5 }] }),
      post(`/api/v1/purchase-orders/${purchaseOrderId}/goods-receipts`, { items: [{ purchaseOrderItemId: itemId, quantityReceived: 5 }] }),
    ]);
    const result = tally(settled.map((response) => response.status));

    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);

    const inventory = await context.prisma.inventory.findFirstOrThrow({ where: { productId } });
    expect(inventory.quantity).toBe(5);

    const item = await context.prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.receivedQuantity).toBe(5);
  });

  it('never lets receivedQuantity exceed the ordered quantity under concurrent load', async () => {
    const { itemId, purchaseOrderId } = await orderedPurchaseOrder('CEILING', 12);

    const settled = await Promise.all(
      Array.from({ length: 10 }, () =>
        post(`/api/v1/purchase-orders/${purchaseOrderId}/goods-receipts`, { items: [{ purchaseOrderItemId: itemId, quantityReceived: 5 }] }),
      ),
    );

    const item = await context.prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.receivedQuantity).toBeLessThanOrEqual(item.quantity);
    expect(settled.filter((response) => response.status === 201).length).toBe(2);
  });
});
