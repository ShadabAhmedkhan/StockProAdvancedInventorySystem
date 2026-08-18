import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { Prisma } from '../src/generated/prisma/client';
import { DeviceType, PaymentMethod, RepairStatus, StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * What two people at the same repair must not be able to do: move it twice,
 * consume its parts twice, take the same part for two different devices, or
 * collect more than the job is worth.
 *
 * These fire genuinely simultaneous requests at the real database and then
 * check the arithmetic still adds up.
 */
describe('Repairs concurrency (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let customerId: string;

  function body<T>(response: { body: ApiResponse<T> }): T {
    return response.body.data;
  }

  function post(path: string, payload: Record<string, unknown> = {}): request.Test {
    return request(context.server).post(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  function patch(path: string, payload: Record<string, unknown>): request.Test {
    return request(context.server).patch(path).set('Authorization', `Bearer ${adminToken}`).send(payload);
  }

  async function makePart(suffix: string, quantity: number): Promise<string> {
    const created = await post('/api/v1/products', {
      sku: `${label}-${suffix}`,
      name: `Race part ${suffix}`,
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

  /** A repair on the bench, ready for parts. */
  async function onTheBench(): Promise<string> {
    const created = await post('/api/v1/repairs', {
      customerId,
      deviceType: DeviceType.PHONE,
      problemDescription: 'Concurrency probe',
    }).expect(201);

    const id = body<{ id: string }>(created).id;

    await post(`/api/v1/repairs/${id}/status`, { toStatus: RepairStatus.DIAGNOSING }).expect(200);
    await post(`/api/v1/repairs/${id}/status`, { toStatus: RepairStatus.APPROVED }).expect(200);
    await post(`/api/v1/repairs/${id}/status`, { toStatus: RepairStatus.IN_PROGRESS }).expect(200);

    return id;
  }

  /**
   * Several repairs on the bench, built one at a time.
   *
   * Setting them up in parallel means dozens of sockets open at once, which
   * the client gives up on before the interesting part of the test begins. It
   * is the requests under test that have to be simultaneous, not the fixtures.
   */
  async function benchMany(count: number): Promise<string[]> {
    const ids: string[] = [];

    for (let index = 0; index < count; index += 1) {
      ids.push(await onTheBench());
    }

    return ids;
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
    label = `RC${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.repairStatusHistory.deleteMany({ where: { changedById: createdById } });
      await context.prisma.repair.deleteMany({ where: { customer: { customerCode: { startsWith: label } } } });
      // One test confirms an order, to prove a sale and a repair compete for
      // the same units; its lines hold the product open until it goes.
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      // Inventory cascades from Product, so deleting it separately only risks
      // stranding products without a stock row if a later delete fails.
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'rep-race', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Race Parts` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const customer = await post('/api/v1/customers', {
      customerCode: `${label}-C1`,
      firstName: 'Race',
      lastName: 'Customer',
      phone: '+1 555 0122',
    }).expect(201);
    customerId = body<{ id: string }>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('moves the repair once when two people press the same button', async () => {
    const repairId = await onTheBench();

    const settled = await Promise.all([
      post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.WAITING_PARTS }),
      post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.WAITING_PARTS }),
    ]);
    const result = tally(settled.map((response) => response.status));

    const history = await context.prisma.repairStatusHistory.count({ where: { repairId, toStatus: RepairStatus.WAITING_PARTS } });

    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);
    // One move, one history row: the loser leaves no trace of a change it
    // never made.
    expect(history).toBe(1);
  });

  it('consumes the parts once when a repair is completed twice at the same moment', async () => {
    const productId = await makePart('DOUBLECOMP', 20);
    const repairId = await onTheBench();

    await post(`/api/v1/repairs/${repairId}/items`, { productId, quantity: 6 }).expect(200);
    await patch(`/api/v1/repairs/${repairId}`, { finalCost: '100.00' }).expect(200);

    const settled = await Promise.all([
      post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.COMPLETED }),
      post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.COMPLETED }),
    ]);
    const result = tally(settled.map((response) => response.status));

    const inventory = await inventoryOf(productId);

    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);
    expect(inventory.quantity).toBe(14);
    expect(inventory.reservedQuantity).toBe(0);
    expect(await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.REPAIR_OUT } })).toBe(1);
  });

  it('lets exactly as many repairs claim a scarce part as there is stock', async () => {
    const stock = 12;
    const attempts = 20;
    const productId = await makePart('SCARCE', stock);
    const repairs = await benchMany(attempts);

    const settled = await Promise.all(repairs.map((id) => post(`/api/v1/repairs/${id}/items`, { productId, quantity: 1 })));
    const result = tally(settled.map((response) => response.status));

    expect(result.ok).toBe(stock);
    expect(result.conflict).toBe(attempts - stock);
    expect(result.other).toEqual([]);
    expect((await inventoryOf(productId)).reservedQuantity).toBe(stock);
  });

  it('does not deadlock when repairs hold the same two parts in opposite order', async () => {
    const first = await makePart('DEADA', 200);
    const second = await makePart('DEADB', 200);
    const repairs = await benchMany(10);

    // Each repair fits both parts, half of them in the other order.
    for (const [index, id] of repairs.entries()) {
      const [a, b] = index % 2 === 0 ? [first, second] : [second, first];

      await post(`/api/v1/repairs/${id}/items`, { productId: a, quantity: 1 }).expect(200);
      await post(`/api/v1/repairs/${id}/items`, { productId: b, quantity: 1 }).expect(200);
      await patch(`/api/v1/repairs/${id}`, { finalCost: '10.00' }).expect(200);
    }

    // Only the completions are simultaneous: that is where the locks collide.

    const settled = await Promise.all(repairs.map((id) => post(`/api/v1/repairs/${id}/status`, { toStatus: RepairStatus.COMPLETED })));
    const result = tally(settled.map((response) => response.status));

    expect(result.other).toEqual([]);
    expect(result.ok).toBe(10);
    expect((await inventoryOf(first)).quantity).toBe(190);
    expect((await inventoryOf(second)).quantity).toBe(190);
  });

  it('keeps a part edit from interleaving with a completion', async () => {
    const productId = await makePart('INTERLEAVE', 50);
    const repairId = await onTheBench();

    await post(`/api/v1/repairs/${repairId}/items`, { productId, quantity: 2 }).expect(200);
    await patch(`/api/v1/repairs/${repairId}`, { finalCost: '75.00' }).expect(200);

    const other = await makePart('INTERLEAVE2', 50);
    const [added] = await Promise.all([
      post(`/api/v1/repairs/${repairId}/items`, { productId: other, quantity: 3 }),
      post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.COMPLETED }),
    ]);

    const items = await context.prisma.repairItem.findMany({ where: { repairId } });
    const consumed = await context.prisma.stockMovement.aggregate({
      where: { referenceId: repairId, type: StockMovementType.REPAIR_OUT },
      _sum: { quantity: true },
    });

    // Either the part was fitted before the job closed and left with it, or it
    // was refused; a finished repair can never hold a part that was never
    // taken out of stock.
    const fitted = items.reduce((sum, item) => sum + item.quantity, 0);
    expect(added.status === 200 ? 5 : 2).toBe(fitted);
    expect(consumed._sum.quantity).toBe(fitted);
  });

  it('never collects more than a repair is worth, however many tills try', async () => {
    const repairId = await onTheBench();
    await patch(`/api/v1/repairs/${repairId}`, { finalCost: '50.00' }).expect(200);
    await post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.COMPLETED }).expect(200);

    const settled = await Promise.all(
      Array.from({ length: 10 }, () => post(`/api/v1/repairs/${repairId}/payments`, { method: PaymentMethod.CASH, amount: '10.00' })),
    );

    const accepted = settled.filter((response) => response.status === 201).length;
    const payments = await context.prisma.payment.findMany({ where: { repairId } });
    const collected = payments.reduce<Prisma.Decimal>((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));

    expect(accepted).toBe(5);
    expect(payments).toHaveLength(5);
    // The repair has no paid-amount column, so this is the sum the guard read.
    expect(collected.toFixed(2)).toBe('50.00');
  });

  it('writes no payment row for an amount it refused', async () => {
    const repairId = await onTheBench();
    await patch(`/api/v1/repairs/${repairId}`, { finalCost: '10.00' }).expect(200);
    await post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.COMPLETED }).expect(200);

    const settled = await Promise.all(
      Array.from({ length: 6 }, () => post(`/api/v1/repairs/${repairId}/payments`, { method: PaymentMethod.CARD, amount: '10.00' })),
    );

    expect(settled.filter((response) => response.status === 201)).toHaveLength(1);
    expect(await context.prisma.payment.count({ where: { repairId } })).toBe(1);
  });

  it('settles on one outcome when a completion and a cancellation race', async () => {
    const productId = await makePart('RACECANCEL', 30);
    const repairId = await onTheBench();

    await post(`/api/v1/repairs/${repairId}/items`, { productId, quantity: 4 }).expect(200);
    await patch(`/api/v1/repairs/${repairId}`, { finalCost: '60.00' }).expect(200);

    const settled = await Promise.all([
      post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.COMPLETED }),
      post(`/api/v1/repairs/${repairId}/status`, { toStatus: RepairStatus.CANCELLED }),
    ]);

    const repair = await context.prisma.repair.findUniqueOrThrow({ where: { id: repairId } });
    const inventory = await inventoryOf(productId);

    expect(tally(settled.map((response) => response.status)).ok).toBe(1);

    // Completed: the parts left. Cancelled: they went back on the shelf.
    // Either way the reservation is gone and the two agree.
    expect(inventory.reservedQuantity).toBe(0);
    expect(inventory.quantity).toBe(repair.status === RepairStatus.COMPLETED ? 26 : 30);
  });

  it('keeps a repair from claiming stock a sale has already taken', async () => {
    const productId = await makePart('VSORDER', 10);
    const repairId = await onTheBench();

    // A confirmed order reserves eight of the ten, so only two are free.
    const order = await post('/api/v1/orders', { items: [{ productId, quantity: 8 }] }).expect(201);
    await post(`/api/v1/orders/${body<{ id: string }>(order).id}/confirm`).expect(200);

    await post(`/api/v1/repairs/${repairId}/items`, { productId, quantity: 5 }).expect(409);
    await post(`/api/v1/repairs/${repairId}/items`, { productId, quantity: 2 }).expect(200);

    const inventory = await inventoryOf(productId);
    expect(inventory.quantity).toBe(10);
    expect(inventory.reservedQuantity).toBe(10);
  });
});
