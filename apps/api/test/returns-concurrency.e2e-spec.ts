import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { Prisma } from '../src/generated/prisma/client';
import { PaymentMethod, PaymentStatus, ReturnReason, ReturnStatus, StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * What two people at the same counter must not be able to do: take back the
 * same unit twice, refund the same return twice, or between them hand back
 * more than the customer ever paid.
 *
 * These fire genuinely simultaneous requests at the real database and then
 * check the arithmetic still adds up.
 */
describe('Returns concurrency (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let customerId: string;

  interface OrderBody {
    id: string;
    items: { id: string }[];
  }

  interface ReturnBody {
    id: string;
    refundAmount: string;
    status: ReturnStatus;
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
      name: `Race returnable ${suffix}`,
      categoryId,
      costPrice: '1.00',
      sellingPrice: '10.00',
    }).expect(201);

    const productId = body<{ id: string }>(created).id;

    await post('/api/v1/stock/adjust', { productId, type: StockMovementType.PURCHASE, quantity }).expect(200);

    return productId;
  }

  /** A completed, fully paid order of `quantity` units at 10.00 each. */
  async function soldOrder(productId: string, quantity: number, paid?: string): Promise<OrderBody> {
    const created = await post('/api/v1/orders', { customerId, items: [{ productId, quantity }] }).expect(201);
    const order = body<OrderBody>(created);

    await post(`/api/v1/orders/${order.id}/confirm`).expect(200);
    await post(`/api/v1/orders/${order.id}/payments`, { method: PaymentMethod.CASH, amount: paid ?? (quantity * 10).toFixed(2) }).expect(201);

    const completed = await post(`/api/v1/orders/${order.id}/complete`).expect(200);

    return body<OrderBody>(completed);
  }

  function raiseReturn(order: OrderBody, quantity: number): request.Test {
    return post('/api/v1/returns', {
      orderId: order.id,
      reason: ReturnReason.DEFECTIVE,
      items: [{ orderItemId: order.items[0]?.id ?? '', quantity }],
    });
  }

  async function approvedReturn(order: OrderBody, quantity: number): Promise<string> {
    const created = await raiseReturn(order, quantity).expect(201);
    const id = body<ReturnBody>(created).id;

    await post(`/api/v1/returns/${id}/approve`).expect(200);

    return id;
  }

  function tally(statuses: number[]): { created: number; conflict: number; refused: number; other: number[] } {
    return {
      created: statuses.filter((status) => status === 201).length,
      conflict: statuses.filter((status) => status === 409).length,
      refused: statuses.filter((status) => status === 422).length,
      other: statuses.filter((status) => ![200, 201, 409, 422].includes(status)),
    };
  }

  beforeAll(async () => {
    // Simultaneous requests are the point of this suite, so the global rate
    // limit is lifted for it; the limiter has its own test.
    context = await createTestApp({ throttleLimit: 10_000 });
    label = `RQ${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });

      await context.prisma.financialTransaction.deleteMany({ where: { createdById } });
      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.return.deleteMany({ where: { createdById } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'ret-race', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Race Returnables` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const customer = await post('/api/v1/customers', {
      customerCode: `${label}-C1`,
      firstName: 'Race',
      lastName: 'Returner',
      phone: '+1 555 0144',
    }).expect(201);
    customerId = body<{ id: string }>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('lets exactly as many returns be raised as the line has units', async () => {
    const productId = await makeProduct('EXACT', 40);
    const order = await soldOrder(productId, 6);

    // Ten people each try to take back two of the six units sold.
    const settled = await Promise.all(Array.from({ length: 10 }, () => raiseReturn(order, 2)));
    const result = tally(settled.map((response) => response.status));

    const claimed = await context.prisma.returnItem.aggregate({
      where: { orderItem: { orderId: order.id } },
      _sum: { quantity: true },
    });

    expect(result.created).toBe(3);
    expect(result.refused).toBe(7);
    expect(result.other).toEqual([]);
    // Six units sold, six units claimed, not eight or twenty.
    expect(claimed._sum.quantity).toBe(6);
  });

  it('never credits more than the line was charged', async () => {
    const productId = await makeProduct('CREDIT', 40);
    const order = await soldOrder(productId, 3);

    await Promise.all(Array.from({ length: 6 }, () => raiseReturn(order, 1)));

    const credited = await context.prisma.returnItem.aggregate({
      where: { orderItem: { orderId: order.id } },
      _sum: { total: true },
    });

    // Three units at 10.00: the sum of every refund is exactly 30.00.
    expect((credited._sum.total ?? new Prisma.Decimal(0)).toFixed(2)).toBe('30.00');
  });

  it('refunds once when the same return is completed twice at the same moment', async () => {
    const productId = await makeProduct('DOUBLEDONE', 40);
    const order = await soldOrder(productId, 4);
    const returnId = await approvedReturn(order, 4);

    const settled = await Promise.all([
      post(`/api/v1/returns/${returnId}/complete`, { method: PaymentMethod.CASH }),
      post(`/api/v1/returns/${returnId}/complete`, { method: PaymentMethod.CASH }),
    ]);
    const statuses = settled.map((response) => response.status);

    const inventory = await context.prisma.inventory.findUniqueOrThrow({ where: { productId } });
    const payments = await context.prisma.payment.count({ where: { returnId } });
    const movements = await context.prisma.stockMovement.count({ where: { referenceId: returnId, type: StockMovementType.RETURN_IN } });

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    // Four units back, once. One refund, one movement.
    expect(inventory.quantity).toBe(40);
    expect(payments).toBe(1);
    expect(movements).toBe(1);
  });

  it('settles on one outcome when an approval and a rejection race', async () => {
    const productId = await makeProduct('RACEDECIDE', 40);
    const order = await soldOrder(productId, 2);
    const created = await raiseReturn(order, 2).expect(201);
    const returnId = body<ReturnBody>(created).id;

    const settled = await Promise.all([post(`/api/v1/returns/${returnId}/approve`), post(`/api/v1/returns/${returnId}/reject`)]);

    const record = await context.prisma.return.findUniqueOrThrow({ where: { id: returnId } });

    expect(settled.filter((response) => response.status === 200)).toHaveLength(1);
    expect([ReturnStatus.APPROVED, ReturnStatus.REJECTED]).toContain(record.status);
  });

  it('never hands back more than the customer paid, however many returns complete at once', async () => {
    const productId = await makeProduct('CASHCAP', 60);
    // Six units sold at 10.00, but only 30.00 was ever collected.
    const order = await soldOrder(productId, 6, '30.00');

    const returns = [await approvedReturn(order, 2), await approvedReturn(order, 2), await approvedReturn(order, 2)];

    await Promise.all(returns.map((id) => post(`/api/v1/returns/${id}/complete`, { method: PaymentMethod.CASH })));

    const refunds = await context.prisma.payment.findMany({ where: { returnRecord: { orderId: order.id } } });
    const handedBack = refunds.reduce<Prisma.Decimal>((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));

    // Every unit comes back into stock, but only the 30.00 that arrived goes
    // back out - never the full 60.00 of goods.
    expect(handedBack.toFixed(2)).toBe('30.00');
    expect((await context.prisma.inventory.findUniqueOrThrow({ where: { productId } })).quantity).toBe(60);
  });

  it('marks the order refunded exactly once when returns complete together', async () => {
    const productId = await makeProduct('REFUNDFLAG', 40);
    const order = await soldOrder(productId, 4);

    const returns = [await approvedReturn(order, 2), await approvedReturn(order, 2)];

    await Promise.all(returns.map((id) => post(`/api/v1/returns/${id}/complete`, { method: PaymentMethod.CASH })));

    const settled = await context.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const refunds = await context.prisma.payment.findMany({ where: { returnRecord: { orderId: order.id } } });
    const handedBack = refunds.reduce<Prisma.Decimal>((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));

    expect(settled.paymentStatus).toBe(PaymentStatus.REFUNDED);
    expect(handedBack.toFixed(2)).toBe('40.00');
  });

  it('keeps stock and the ledger agreeing after concurrent restocking', async () => {
    const productId = await makeProduct('LEDGER', 100);
    const order = await soldOrder(productId, 10);

    const returns: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      returns.push(await approvedReturn(order, 2));
    }

    await Promise.all(returns.map((id) => post(`/api/v1/returns/${id}/complete`, { method: PaymentMethod.CASH })));

    const movements = await context.prisma.stockMovement.findMany({ where: { productId, type: StockMovementType.RETURN_IN } });
    const restored = movements.reduce((sum, movement) => sum + movement.quantity, 0);
    const inventory = await context.prisma.inventory.findUniqueOrThrow({ where: { productId } });

    expect(restored).toBe(10);
    expect(inventory.quantity).toBe(100);
    // Every movement's chain links, whatever order they committed in.
    expect(movements.every((movement) => movement.newQuantity === movement.previousQuantity + movement.quantity)).toBe(true);
  });
});
