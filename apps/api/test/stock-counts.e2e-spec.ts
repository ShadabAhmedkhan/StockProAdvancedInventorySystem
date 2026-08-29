import request from 'supertest';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import { StockCountStatus, StockReferenceType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

/**
 * The stock count lifecycle end to end: draft with items -> start -> submit
 * counts (including a recount) -> submit for review -> approve -> complete,
 * checking that only APPROVE touches Inventory/StockMovement, that blind
 * counting hides `expectedQuantity` until REVIEW, and that cancel works
 * before approval but is refused afterwards.
 */
describe('Stock counts (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let locationId: string;

  interface StockCountItemBody {
    id: string;
    productId: string;
    expectedQuantity: number | null;
    countedQuantity: number | null;
  }

  interface StockCountBody {
    id: string;
    status: StockCountStatus;
    items: StockCountItemBody[];
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
      name: `SC ${suffix}`,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
    }).expect(201);

    return body<{ id: string }>(created).id;
  }

  async function stockUp(productId: string, quantity: number): Promise<void> {
    await post('/api/v1/stock/adjust', { productId, type: 'ADJUSTMENT_IN', quantity, note: 'Seed for stock count test' }).expect(200);
  }

  async function inventoryOf(productId: string): Promise<{ quantity: number; reservedQuantity: number }> {
    const row = await context.prisma.inventory.findFirstOrThrow({ where: { productId, locationId } });

    return { quantity: row.quantity, reservedQuantity: row.reservedQuantity };
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `SC${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });
      await context.prisma.stockCountItem.deleteMany({ where: { stockCount: { createdById } } });
      await context.prisma.stockCount.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'sc-lifecycle', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Category` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const locations = await get('/api/v1/locations').expect(200);
    locationId = body<{ id: string; isDefault: boolean }[]>(locations).find((location) => location.isDefault)?.id ?? '';
    expect(locationId).not.toBe('');
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('runs the full lifecycle: draft -> start -> count -> review -> approve -> complete', async () => {
    const productA = await makeProduct('A1');
    const productB = await makeProduct('B1');
    await stockUp(productA, 10);
    await stockUp(productB, 5);

    const created = await post('/api/v1/stock-counts', { locationId, productIds: [productA, productB] }).expect(201);
    const stockCount = body<StockCountBody>(created);
    expect(stockCount.status).toBe('DRAFT');

    // Blind counting: expectedQuantity is withheld even in DRAFT.
    for (const item of stockCount.items) {
      expect(item.expectedQuantity).toBeNull();
    }

    const itemA = stockCount.items.find((item) => item.productId === productA);
    const itemB = stockCount.items.find((item) => item.productId === productB);
    if (itemA === undefined || itemB === undefined) throw new Error('items missing');

    await post(`/api/v1/stock-counts/${stockCount.id}/start`).expect(200);

    // Recount: the first entry is overwritten by the second while still COUNTING.
    await patch(`/api/v1/stock-counts/${stockCount.id}/items/${itemA.id}/count`, { countedQuantity: 7 }).expect(200);
    const recounted = await patch(`/api/v1/stock-counts/${stockCount.id}/items/${itemA.id}/count`, { countedQuantity: 9 }).expect(200);
    expect(body<StockCountBody>(recounted).items.find((item) => item.id === itemA.id)?.countedQuantity).toBe(9);

    await patch(`/api/v1/stock-counts/${stockCount.id}/items/${itemB.id}/count`, { countedQuantity: 5 }).expect(200);

    const inventoryBeforeApproval = await inventoryOf(productA);
    expect(inventoryBeforeApproval.quantity).toBe(10);

    const reviewed = await post(`/api/v1/stock-counts/${stockCount.id}/submit-for-review`).expect(200);
    const reviewedBody = body<StockCountBody>(reviewed);
    expect(reviewedBody.status).toBe('REVIEW');
    // Variance is now visible.
    expect(reviewedBody.items.find((item) => item.productId === productA)?.expectedQuantity).toBe(10);

    const approved = await post(`/api/v1/stock-counts/${stockCount.id}/approve`).expect(200);
    expect(body<StockCountBody>(approved).status).toBe('APPROVED');

    // productA: 10 expected, 9 counted -> variance -1. productB: no variance, no movement.
    const inventoryAfterApproval = await inventoryOf(productA);
    expect(inventoryAfterApproval.quantity).toBe(9);

    const movements = await context.prisma.stockMovement.findMany({ where: { referenceType: StockReferenceType.STOCK_COUNT, referenceId: stockCount.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.productId).toBe(productA);
    expect(movements[0]?.quantity).toBe(1);

    const completed = await post(`/api/v1/stock-counts/${stockCount.id}/complete`).expect(200);
    expect(body<StockCountBody>(completed).status).toBe('COMPLETED');
  });

  it('refuses to cancel once approved', async () => {
    const product = await makeProduct('CANCELGUARD');
    await stockUp(product, 3);

    const created = await post('/api/v1/stock-counts', { locationId, productIds: [product] }).expect(201);
    const stockCount = body<StockCountBody>(created);
    const item = stockCount.items[0];
    if (item === undefined) throw new Error('item missing');

    await post(`/api/v1/stock-counts/${stockCount.id}/start`).expect(200);
    await patch(`/api/v1/stock-counts/${stockCount.id}/items/${item.id}/count`, { countedQuantity: 3 }).expect(200);
    await post(`/api/v1/stock-counts/${stockCount.id}/submit-for-review`).expect(200);
    await post(`/api/v1/stock-counts/${stockCount.id}/approve`).expect(200);

    const response = await post(`/api/v1/stock-counts/${stockCount.id}/cancel`).expect(409);
    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.CONFLICT);
  });

  it('cancels a draft count', async () => {
    const product = await makeProduct('CANCELOK');
    await stockUp(product, 1);

    const created = await post('/api/v1/stock-counts', { locationId, productIds: [product] }).expect(201);
    const stockCount = body<StockCountBody>(created);

    const cancelled = await post(`/api/v1/stock-counts/${stockCount.id}/cancel`).expect(200);
    expect(body<StockCountBody>(cancelled).status).toBe('CANCELLED');
  });

  it('refuses to start counting with no items', async () => {
    const created = await post('/api/v1/stock-counts', { locationId, productIds: [] }).expect(201);
    const stockCount = body<StockCountBody>(created);

    const response = await post(`/api/v1/stock-counts/${stockCount.id}/start`).expect(422);
    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNPROCESSABLE_ENTITY);
  });

  it('refuses to submit for review while any line is still uncounted', async () => {
    const product = await makeProduct('UNCOUNTED');
    await stockUp(product, 2);

    const created = await post('/api/v1/stock-counts', { locationId, productIds: [product] }).expect(201);
    const stockCount = body<StockCountBody>(created);

    await post(`/api/v1/stock-counts/${stockCount.id}/start`).expect(200);

    const response = await post(`/api/v1/stock-counts/${stockCount.id}/submit-for-review`).expect(422);
    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.UNPROCESSABLE_ENTITY);
  });

  it('refuses staff from opening a count', async () => {
    const staffToken = (await inviteTeammate(context, adminToken, 'sc-staff', UserRole.STAFF)).accessToken;

    const response = await request(context.server)
      .post('/api/v1/stock-counts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ locationId, productIds: [] })
      .expect(403);

    expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
  });
});
