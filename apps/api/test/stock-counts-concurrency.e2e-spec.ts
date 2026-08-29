import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { StockReferenceType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * Two simultaneous approve calls on the same stock count must not both apply
 * the inventory adjustment - the conditional UPDATE backing the REVIEW ->
 * APPROVED transition only ever matches one of them. Same for two
 * simultaneous complete calls. Mirrors the structure of
 * stock-transfers-concurrency.e2e-spec.ts.
 */
describe('Stock counts concurrency (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let locationId: string;

  interface StockCountBody {
    id: string;
    status: string;
    items: { id: string; productId: string }[];
  }

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

  async function makeProduct(suffix: string): Promise<string> {
    const created = await post('/api/v1/products', {
      sku: `${label}-${suffix}`,
      name: `Race ${suffix}`,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
    }).expect(201);

    return body<{ id: string }>(created).id;
  }

  async function stockUp(productId: string, quantity: number): Promise<void> {
    await post('/api/v1/stock/adjust', { productId, type: 'ADJUSTMENT_IN', quantity, note: 'Seed for stock count race' }).expect(200);
  }

  async function reviewedCount(suffix: string, productId: string, countedQuantity: number): Promise<string> {
    const created = await post('/api/v1/stock-counts', { locationId, productIds: [productId] }).expect(201);
    const stockCount = body<StockCountBody>(created);
    const item = stockCount.items[0];
    if (item === undefined) throw new Error('item missing');

    await post(`/api/v1/stock-counts/${stockCount.id}/start`).expect(200);
    await patch(`/api/v1/stock-counts/${stockCount.id}/items/${item.id}/count`, { countedQuantity }).expect(200);
    await post(`/api/v1/stock-counts/${stockCount.id}/submit-for-review`).expect(200);

    return stockCount.id;
  }

  function tally(statuses: number[]): { ok: number; conflict: number; other: number[] } {
    return {
      ok: statuses.filter((status) => status === 200).length,
      conflict: statuses.filter((status) => status === 409).length,
      other: statuses.filter((status) => status !== 200 && status !== 409),
    };
  }

  beforeAll(async () => {
    context = await createTestApp({ throttleLimit: 10_000 });
    label = `SCC${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });
      await context.prisma.stockCountItem.deleteMany({ where: { stockCount: { createdById } } });
      await context.prisma.stockCount.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'sc-race', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Category` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const locations = await get('/api/v1/locations').expect(200);
    locationId = body<{ id: string; isDefault: boolean }[]>(locations).find((location) => location.isDefault)?.id ?? '';
    expect(locationId).not.toBe('');
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('approves exactly once when the same count is approved twice at the same moment', async () => {
    const productId = await makeProduct('DOUBLEAPPROVE');
    await stockUp(productId, 10);
    const stockCountId = await reviewedCount('DOUBLEAPPROVE', productId, 7);

    const settled = await Promise.all([post(`/api/v1/stock-counts/${stockCountId}/approve`), post(`/api/v1/stock-counts/${stockCountId}/approve`)]);
    const result = tally(settled.map((response) => response.status));

    expect(result.other).toEqual([]);
    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);

    const inventory = await context.prisma.inventory.findFirstOrThrow({ where: { productId, locationId } });
    expect(inventory.quantity).toBe(7);

    const movements = await context.prisma.stockMovement.findMany({ where: { productId, referenceType: StockReferenceType.STOCK_COUNT } });
    expect(movements).toHaveLength(1);
  });

  it('completes exactly once when the same count is completed twice at the same moment', async () => {
    const productId = await makeProduct('DOUBLECOMPLETE');
    await stockUp(productId, 4);
    const stockCountId = await reviewedCount('DOUBLECOMPLETE', productId, 4);
    await post(`/api/v1/stock-counts/${stockCountId}/approve`).expect(200);

    const settled = await Promise.all([post(`/api/v1/stock-counts/${stockCountId}/complete`), post(`/api/v1/stock-counts/${stockCountId}/complete`)]);
    const result = tally(settled.map((response) => response.status));

    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);
  });
});
