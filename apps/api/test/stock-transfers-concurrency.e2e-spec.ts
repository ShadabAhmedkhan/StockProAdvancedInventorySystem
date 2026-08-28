import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { StockReferenceType, StockTransferStatus, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * Two simultaneous approvals racing to reserve more of a source location's
 * stock than is actually available must not both succeed - the same
 * conditional-UPDATE guard `reserveStock` uses for orders. Two simultaneous
 * ship/complete calls on the same transfer must not both succeed either,
 * since the lifecycle's conditional UPDATE only ever matches one of them.
 * Mirrors the structure of purchase-orders-concurrency.e2e-spec.ts.
 */
describe('Stock transfers concurrency (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let sourceLocationId: string;
  let destinationLocationId: string;

  interface StockTransferBody {
    id: string;
    status: StockTransferStatus;
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
      name: `Race ${suffix}`,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
    }).expect(201);

    return body<{ id: string }>(created).id;
  }

  async function stockAtSource(productId: string, quantity: number): Promise<void> {
    await post('/api/v1/stock/adjust', { productId, type: 'ADJUSTMENT_IN', quantity, note: 'Seed for transfer race' }).expect(200);
  }

  async function requestedTransfer(suffix: string, productId: string, quantity: number): Promise<string> {
    const created = await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId,
      items: [{ productId, quantity }],
    }).expect(201);
    const transfer = body<StockTransferBody>(created);

    await post(`/api/v1/stock-transfers/${transfer.id}/request`).expect(200);

    return transfer.id;
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
    label = `TRFC${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });
      await context.prisma.stockTransferItem.deleteMany({ where: { transfer: { createdById } } });
      await context.prisma.stockTransfer.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
      await context.prisma.location.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'trf-race', UserRole.ADMIN)).accessToken;

    const category = await post('/api/v1/categories', { name: `${label} Category` }).expect(201);
    categoryId = body<{ id: string }>(category).id;

    const defaultLocations = await get('/api/v1/locations').expect(200);
    sourceLocationId = body<{ id: string; isDefault: boolean }[]>(defaultLocations).find((location) => location.isDefault)?.id ?? '';
    expect(sourceLocationId).not.toBe('');

    const destination = await post('/api/v1/locations', { name: `${label} Warehouse`, type: 'WAREHOUSE' }).expect(201);
    destinationLocationId = body<{ id: string }>(destination).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('lets only as many approvals through as the source location has available', async () => {
    // 10 available, 4 transfers requesting 3 each = 12 requested: exactly 3
    // can be approved (9 reserved), the 4th always overshoots.
    const productId = await makeProduct('SPLIT');
    await stockAtSource(productId, 10);

    const transferIds = await Promise.all(Array.from({ length: 4 }, (_unused, index) => requestedTransfer(`SPLIT${String(index)}`, productId, 3)));

    const settled = await Promise.all(transferIds.map((id) => post(`/api/v1/stock-transfers/${id}/approve`)));
    const result = tally(settled.map((response) => response.status));

    expect(result.other).toEqual([]);
    expect(result.ok).toBe(3);
    expect(result.conflict).toBe(1);

    const inventory = await context.prisma.inventory.findFirstOrThrow({ where: { productId, locationId: sourceLocationId } });
    expect(inventory.quantity).toBe(10);
    expect(inventory.reservedQuantity).toBe(9);
  });

  it('ships exactly once when the same transfer is shipped twice at the same moment', async () => {
    const productId = await makeProduct('DOUBLESHIP');
    await stockAtSource(productId, 5);
    const transferId = await requestedTransfer('DOUBLESHIP', productId, 5);
    await post(`/api/v1/stock-transfers/${transferId}/approve`).expect(200);

    const settled = await Promise.all([post(`/api/v1/stock-transfers/${transferId}/ship`), post(`/api/v1/stock-transfers/${transferId}/ship`)]);
    const result = tally(settled.map((response) => response.status));

    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);

    const inventory = await context.prisma.inventory.findFirstOrThrow({ where: { productId, locationId: sourceLocationId } });
    expect(inventory.quantity).toBe(0);
    expect(inventory.reservedQuantity).toBe(0);

    const movements = await context.prisma.stockMovement.findMany({ where: { productId, referenceType: StockReferenceType.TRANSFER } });
    expect(movements.reduce((sum, movement) => sum + movement.quantity, 0)).toBe(5);
  });

  it('completes exactly once when the same transfer is completed twice at the same moment', async () => {
    const productId = await makeProduct('DOUBLECOMPLETE');
    await stockAtSource(productId, 5);
    const transferId = await requestedTransfer('DOUBLECOMPLETE', productId, 5);
    await post(`/api/v1/stock-transfers/${transferId}/approve`).expect(200);
    await post(`/api/v1/stock-transfers/${transferId}/ship`).expect(200);

    const settled = await Promise.all([post(`/api/v1/stock-transfers/${transferId}/complete`), post(`/api/v1/stock-transfers/${transferId}/complete`)]);
    const result = tally(settled.map((response) => response.status));

    expect(result.ok).toBe(1);
    expect(result.conflict).toBe(1);

    const destinationInventory = await context.prisma.inventory.findFirstOrThrow({ where: { productId, locationId: destinationLocationId } });
    expect(destinationInventory.quantity).toBe(5);
  });
});
