import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { Prisma } from '../src/generated/prisma/client';
import { OrderStatus, PaymentMethod, StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * What two tills doing the same thing at the same instant must not be able to
 * do: sell the same unit twice, reserve it twice, ship it twice, or collect
 * more money than the sale is worth.
 *
 * These fire genuinely simultaneous requests at the real database and then
 * check the arithmetic still adds up.
 */
describe('Orders concurrency (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;

  interface OrderBody {
    id: string;
    status: OrderStatus;
    total: string;
    paidAmount: string;
  }

  function body<T>(response: { body: ApiResponse<T> }): T {
    return response.body.data;
  }

  function post(path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).post(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  async function makeProduct(suffix: string, quantity: number): Promise<string> {
    const created = await post('/api/v1/products', {
      sku: `${label}-${suffix}`,
      name: `Race ${suffix}`,
      categoryId,
      costPrice: '1.00',
      sellingPrice: '10.00',
    }).expect(201);

    const productId = body<{ id: string }>(created).id;

    if (quantity > 0) {
      await post('/api/v1/stock/adjust', { productId, type: StockMovementType.PURCHASE, quantity }).expect(200);
    }

    return productId;
  }

  /** A draft holding one line of each product given. */
  async function draft(lines: { productId: string; quantity: number }[]): Promise<string> {
    const created = await post('/api/v1/orders', { items: lines }).expect(201);

    return body<OrderBody>(created).id;
  }

  async function inventoryOf(productId: string): Promise<{ quantity: number; reservedQuantity: number }> {
    const row = await context.prisma.inventory.findUniqueOrThrow({ where: { productId } });

    return { quantity: row.quantity, reservedQuantity: row.reservedQuantity };
  }

  function tally(statuses: number[]): { ok: number; conflict: number; other: number[] } {
    return {
      ok: statuses.filter((status) => status === 200).length,
      conflict: statuses.filter((status) => status === 409).length,
      other: statuses.filter((status) => status !== 200 && status !== 409),
    };
  }

  beforeAll(async () => {
    // Hundreds of simultaneous requests is the point of this suite, so the
    // global rate limit is lifted for it; the limiter has its own test.
    context = await createTestApp({ throttleLimit: 10_000 });
    label = `OC${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      // Inventory cascades from Product, so deleting it separately only risks
      // stranding products without a stock row if a later delete fails.
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'orders-race', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Race Category` }).expect(201);
    categoryId = body<{ id: string }>(category).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('lets exactly as many orders confirm as there is stock to cover', async () => {
    const stock = 20;
    const attempts = 30;
    const productId = await makeProduct('EXACT', stock);
    const orders = await Promise.all(Array.from({ length: attempts }, () => draft([{ productId, quantity: 1 }])));

    const settled = await Promise.all(orders.map((id) => post(`/api/v1/orders/${id}/confirm`)));
    const result = tally(settled.map((response) => response.status));

    expect(result.ok).toBe(stock);
    expect(result.conflict).toBe(attempts - stock);
    // Nothing else may happen: no 500s from a constraint slipping through.
    expect(result.other).toEqual([]);
    expect((await inventoryOf(productId)).reservedQuantity).toBe(stock);
  });

  it('never reserves more than is on the shelf', async () => {
    const productId = await makeProduct('CEILING', 12);
    const orders = await Promise.all(Array.from({ length: 10 }, () => draft([{ productId, quantity: 5 }])));

    await Promise.all(orders.map((id) => post(`/api/v1/orders/${id}/confirm`)));

    const inventory = await inventoryOf(productId);
    expect(inventory.reservedQuantity).toBeLessThanOrEqual(inventory.quantity);
    expect(inventory.reservedQuantity).toBe(10);
  });

  it('reserves once when the same order is confirmed twice at the same moment', async () => {
    const productId = await makeProduct('DOUBLECONF', 20);
    const orderId = await draft([{ productId, quantity: 4 }]);

    const settled = await Promise.all([post(`/api/v1/orders/${orderId}/confirm`), post(`/api/v1/orders/${orderId}/confirm`)]);
    const result = tally(settled.map((response) => response.status));

    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);
    // Four units, not eight: the losing request reserved nothing at all.
    expect((await inventoryOf(productId)).reservedQuantity).toBe(4);
  });

  it('ships once when the same order is completed twice at the same moment', async () => {
    const productId = await makeProduct('DOUBLECOMP', 20);
    const orderId = await draft([{ productId, quantity: 6 }]);
    await post(`/api/v1/orders/${orderId}/confirm`).expect(200);

    const settled = await Promise.all([post(`/api/v1/orders/${orderId}/complete`), post(`/api/v1/orders/${orderId}/complete`)]);
    const result = tally(settled.map((response) => response.status));

    const inventory = await inventoryOf(productId);
    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);
    expect(inventory.quantity).toBe(14);
    expect(inventory.reservedQuantity).toBe(0);
    expect(await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.SALE } })).toBe(1);
  });

  it('settles on one outcome when a confirmation and a cancellation race', async () => {
    const productId = await makeProduct('RACECANCEL', 15);
    const orderId = await draft([{ productId, quantity: 3 }]);

    const [confirm, cancel] = await Promise.all([post(`/api/v1/orders/${orderId}/confirm`), post(`/api/v1/orders/${orderId}/cancel`)]);

    const after = await request(context.server).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const status = body<OrderBody>(after).status;
    const reserved = (await inventoryOf(productId)).reservedQuantity;

    // Whichever won, the reservation matches the state the order ended in.
    expect([OrderStatus.CONFIRMED, OrderStatus.CANCELLED]).toContain(status);
    expect(reserved).toBe(status === OrderStatus.CONFIRMED ? 3 : 0);
    expect([confirm.status, cancel.status].filter((code) => code === 200)).toHaveLength(1);
  });

  it('does not deadlock when orders hold the same products in opposite order', async () => {
    const first = await makeProduct('DEADA', 200);
    const second = await makeProduct('DEADB', 200);

    const pairs = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        draft(
          index % 2 === 0
            ? [
                { productId: first, quantity: 1 },
                { productId: second, quantity: 1 },
              ]
            : [
                { productId: second, quantity: 1 },
                { productId: first, quantity: 1 },
              ],
        ),
      ),
    );

    const settled = await Promise.all(pairs.map((id) => post(`/api/v1/orders/${id}/confirm`)));
    const result = tally(settled.map((response) => response.status));

    // Inventory rows are always locked in the same product order, so no pair
    // can take the two locks in opposite directions and wedge.
    expect(result.other).toEqual([]);
    expect(result.ok).toBe(12);
    expect((await inventoryOf(first)).reservedQuantity).toBe(12);
    expect((await inventoryOf(second)).reservedQuantity).toBe(12);
  });

  it('keeps a manual stock adjustment from taking units an order has reserved', async () => {
    const productId = await makeProduct('RESERVEDVSADJ', 10);
    const orderId = await draft([{ productId, quantity: 8 }]);
    await post(`/api/v1/orders/${orderId}/confirm`).expect(200);

    // Only two units are unreserved, so a withdrawal of five must be refused.
    await post('/api/v1/stock/adjust', { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 5 }).expect(409);

    const inventory = await inventoryOf(productId);
    expect(inventory.quantity).toBe(10);
    expect(inventory.reservedQuantity).toBe(8);
  });

  it('reconciles the ledger with the shelf after many simultaneous completions', async () => {
    const productId = await makeProduct('LEDGER', 100);
    const orders = await Promise.all(Array.from({ length: 20 }, () => draft([{ productId, quantity: 3 }])));
    await Promise.all(orders.map((id) => post(`/api/v1/orders/${id}/confirm`)));

    await Promise.all(orders.map((id) => post(`/api/v1/orders/${id}/complete`)));

    const movements = await context.prisma.stockMovement.findMany({ where: { productId, type: StockMovementType.SALE } });
    const sold = movements.reduce((sum, movement) => sum + movement.quantity, 0);
    const inventory = await inventoryOf(productId);

    expect(sold).toBe(60);
    expect(inventory.quantity).toBe(100 - sold);
    expect(inventory.reservedQuantity).toBe(0);
  });

  it('never collects more than the order is worth, however many cashiers try', async () => {
    const productId = await makeProduct('CASH', 50);
    const orderId = await draft([{ productId, quantity: 5 }]);
    await post(`/api/v1/orders/${orderId}/confirm`).expect(200);

    // Ten simultaneous payments of 10.00 against a 50.00 order.
    const settled = await Promise.all(
      Array.from({ length: 10 }, () => post(`/api/v1/orders/${orderId}/payments`, { method: PaymentMethod.CASH, amount: '10.00' })),
    );

    const accepted = settled.filter((response) => response.status === 201).length;
    const rejected = settled.filter((response) => response.status === 409).length;

    const order = await context.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const payments = await context.prisma.payment.findMany({ where: { orderId } });
    const collected = payments.reduce<Prisma.Decimal>((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));

    expect(accepted).toBe(5);
    expect(rejected).toBe(5);
    expect(order.paidAmount.toFixed(2)).toBe('50.00');
    // The recorded payments add up to exactly what the order says it took.
    expect(collected.toFixed(2)).toBe('50.00');
    expect(payments).toHaveLength(5);
  });

  it('writes no payment row for an amount it refused', async () => {
    const productId = await makeProduct('NOPAYROW', 20);
    const orderId = await draft([{ productId, quantity: 1 }]);
    await post(`/api/v1/orders/${orderId}/confirm`).expect(200);

    const settled = await Promise.all(
      Array.from({ length: 6 }, () => post(`/api/v1/orders/${orderId}/payments`, { method: PaymentMethod.CARD, amount: '10.00' })),
    );

    const accepted = settled.filter((response) => response.status === 201).length;
    expect(accepted).toBe(1);
    expect(await context.prisma.payment.count({ where: { orderId } })).toBe(1);
  });

  it('keeps a draft edit and a confirmation from interleaving', async () => {
    const first = await makeProduct('INTERLEAVEA', 50);
    const second = await makeProduct('INTERLEAVEB', 50);
    const orderId = await draft([{ productId: first, quantity: 2 }]);

    const [addItem] = await Promise.all([
      post(`/api/v1/orders/${orderId}/items`, { productId: second, quantity: 4 }),
      post(`/api/v1/orders/${orderId}/confirm`),
    ]);

    const order = await context.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const reservedSecond = (await inventoryOf(second)).reservedQuantity;

    // Either the line landed while the order was still a draft and was
    // reserved with the rest, or it was refused; a confirmed order can never
    // hold a line that nothing reserved.
    expect(order.items).toHaveLength(addItem.status === 200 ? 2 : 1);
    expect(reservedSecond).toBe(addItem.status === 200 ? 4 : 0);
  });
});
