import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { StockMovementType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * The race condition this whole module is built to survive.
 *
 * Two people selling the last unit at the same moment must not both succeed.
 * A check in JavaScript followed by a write cannot prevent that: both requests
 * read the same value before either writes. These tests fire genuinely
 * simultaneous requests at the real database and assert the arithmetic still
 * adds up afterwards.
 */
describe('Stock concurrency (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;

  async function createStockedProduct(suffix: string, quantity: number): Promise<string> {
    const created = await request(context.server)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku: `${label}-${suffix}`, name: `Race ${suffix}`, categoryId, costPrice: '1.00', sellingPrice: '2.00' })
      .expect(201);

    const productId = (created.body as ApiResponse<{ id: string }>).data.id;

    if (quantity > 0) {
      await request(context.server)
        .post('/api/v1/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, type: StockMovementType.PURCHASE, quantity })
        .expect(200);
    }

    return productId;
  }

  /** Fires `count` identical adjustments at once and reports how each fared. */
  async function fireConcurrently(productId: string, type: StockMovementType, quantity: number, count: number): Promise<number[]> {
    const attempts = Array.from({ length: count }, () =>
      request(context.server).post('/api/v1/stock/adjust').set('Authorization', `Bearer ${adminToken}`).send({ productId, type, quantity }),
    );

    const settled = await Promise.all(attempts);
    return settled.map((response) => response.status);
  }

  beforeAll(async () => {
    // Hundreds of simultaneous requests is the point of this suite, so the
    // global rate limit is lifted for it; the limiter has its own test.
    context = await createTestApp({ throttleLimit: 10_000 });
    label = `RC${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      await context.prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: label } } } });
      await context.prisma.inventory.deleteMany({ where: { product: { sku: { startsWith: label } } } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'race-admin', UserRole.ADMIN)).accessToken;

    const category = await request(context.server)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Race Category` })
      .expect(201);
    categoryId = (category.body as ApiResponse<{ id: string }>).data.id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('lets exactly as many concurrent withdrawals succeed as there is stock', async () => {
    const stock = 20;
    const attempts = 30;
    const productId = await createStockedProduct('EXACT', stock);

    const statuses = await fireConcurrently(productId, StockMovementType.ADJUSTMENT_OUT, 1, attempts);

    const succeeded = statuses.filter((status) => status === 200).length;
    const conflicted = statuses.filter((status) => status === 409).length;

    expect(succeeded).toBe(stock);
    expect(conflicted).toBe(attempts - stock);
    // Nothing else may happen: no 500s from a constraint violation slipping through.
    expect(succeeded + conflicted).toBe(attempts);
  });

  it('never lets stock go negative', async () => {
    const productId = await createStockedProduct('FLOOR', 5);

    await fireConcurrently(productId, StockMovementType.ADJUSTMENT_OUT, 1, 25);

    const inventory = await context.prisma.inventory.findUniqueOrThrow({ where: { productId } });
    expect(inventory.quantity).toBe(0);
    expect(inventory.quantity).toBeGreaterThanOrEqual(0);
  });

  it('writes exactly one movement per successful withdrawal, and none for a rejected one', async () => {
    const stock = 15;
    const productId = await createStockedProduct('LEDGER', stock);

    const statuses = await fireConcurrently(productId, StockMovementType.ADJUSTMENT_OUT, 1, 25);
    const succeeded = statuses.filter((status) => status === 200).length;

    const outbound = await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.ADJUSTMENT_OUT } });

    // A rejected attempt must roll back its movement too, or the ledger would
    // claim stock left that never did.
    expect(outbound).toBe(succeeded);
    expect(outbound).toBe(stock);
  });

  it('keeps the ledger reconciling with the level under concurrent traffic in both directions', async () => {
    const productId = await createStockedProduct('MIXED', 40);

    await Promise.all([
      fireConcurrently(productId, StockMovementType.ADJUSTMENT_OUT, 2, 15),
      fireConcurrently(productId, StockMovementType.ADJUSTMENT_IN, 3, 10),
      fireConcurrently(productId, StockMovementType.PURCHASE, 1, 10),
    ]);

    const movements = await context.prisma.stockMovement.findMany({ where: { productId } });
    const inbound = new Set<StockMovementType>([StockMovementType.PURCHASE, StockMovementType.ADJUSTMENT_IN]);
    const net = movements.reduce((sum, movement) => sum + (inbound.has(movement.type) ? movement.quantity : -movement.quantity), 0);

    const inventory = await context.prisma.inventory.findUniqueOrThrow({ where: { productId } });
    expect(inventory.quantity).toBe(net);
    expect(inventory.quantity).toBeGreaterThanOrEqual(0);
  });

  it('adds up correctly when concurrent withdrawals ask for different amounts', async () => {
    const productId = await createStockedProduct('VARIED', 30);

    const sizes = [7, 3, 11, 5, 9, 2, 13, 4, 6, 8];
    const settled = await Promise.all(
      sizes.map((quantity) =>
        request(context.server)
          .post('/api/v1/stock/adjust')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ productId, type: StockMovementType.ADJUSTMENT_OUT, quantity }),
      ),
    );

    const withdrawn = settled
      .filter((response) => response.status === 200)
      .reduce((sum, response) => sum + ((response.body as ApiResponse<{ quantity: number }>).data.quantity || 0), 0);

    const inventory = await context.prisma.inventory.findUniqueOrThrow({ where: { productId } });

    expect(withdrawn).toBeLessThanOrEqual(30);
    expect(inventory.quantity).toBe(30 - withdrawn);
    expect(settled.every((response) => response.status === 200 || response.status === 409)).toBe(true);
  });

  it('honours a reservation while concurrent withdrawals compete for the rest', async () => {
    const productId = await createStockedProduct('RESERVED', 20);
    await context.prisma.inventory.update({ where: { productId }, data: { reservedQuantity: 12 } });

    // Only eight units are actually free.
    const statuses = await fireConcurrently(productId, StockMovementType.ADJUSTMENT_OUT, 1, 20);
    const succeeded = statuses.filter((status) => status === 200).length;

    const inventory = await context.prisma.inventory.findUniqueOrThrow({ where: { productId } });

    expect(succeeded).toBe(8);
    expect(inventory.quantity).toBe(12);
    // The database check constraint would have rejected any breach of this.
    expect(inventory.quantity).toBeGreaterThanOrEqual(inventory.reservedQuantity);

    await context.prisma.inventory.update({ where: { productId }, data: { reservedQuantity: 0 } });
  });
});
