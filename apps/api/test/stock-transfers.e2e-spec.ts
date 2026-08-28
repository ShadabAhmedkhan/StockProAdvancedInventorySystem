import request from 'supertest';
import type { ApiResponse } from '../src/common/interfaces/api-response.interface';
import { StockMovementType, StockReferenceType, StockTransferStatus, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

/**
 * The stock transfer lifecycle end to end: draft with items -> request ->
 * approve -> ship -> complete, checking status transitions and Inventory at
 * BOTH locations and the two StockMovement rows at each step. Also covers
 * the "total quantity across both locations is conserved" invariant, and
 * that cancel works pre-ship but is refused post-ship.
 */
describe('Stock transfers (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let categoryId: string;
  let sourceLocationId: string;
  let destinationLocationId: string;

  interface StockTransferBody {
    id: string;
    status: StockTransferStatus;
    items: { id: string; productId: string; quantity: number }[];
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
      name: `TRF ${suffix}`,
      categoryId,
      costPrice: '5.00',
      sellingPrice: '10.00',
    }).expect(201);

    return body<{ id: string }>(created).id;
  }

  /**
   * Seeds `quantity` units at the organization's default location (which is
   * always used as `sourceLocationId` in this spec) via a stock adjustment -
   * `stock/adjust` has no location parameter of its own, so this only works
   * for seeding the default location.
   */
  async function stockAt(productId: string, _locationId: string, quantity: number): Promise<void> {
    await post('/api/v1/stock/adjust', { productId, type: 'ADJUSTMENT_IN', quantity, note: 'Seed for transfer test' }).expect(200);
  }

  async function inventoryAt(productId: string, locationId: string): Promise<{ quantity: number; reservedQuantity: number }> {
    const row = await context.prisma.inventory.findUnique({ where: { productId_locationId: { productId, locationId } } });

    return row === null ? { quantity: 0, reservedQuantity: 0 } : { quantity: row.quantity, reservedQuantity: row.reservedQuantity };
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `TRF${context.run.slice(0, 5).toUpperCase()}`;

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

    adminToken = (await signInAs(context, 'trf-lifecycle', UserRole.ADMIN)).accessToken;

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

  it('runs the full draft -> request -> approve -> ship -> complete lifecycle, conserving total quantity', async () => {
    const productId = await makeProduct('LIFECYCLE');
    await stockAt(productId, sourceLocationId, 10);

    const created = await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId,
      items: [{ productId, quantity: 6 }],
    }).expect(201);
    const transfer = body<StockTransferBody>(created);
    expect(transfer.status).toBe(StockTransferStatus.DRAFT);

    const requested = await post(`/api/v1/stock-transfers/${transfer.id}/request`).expect(200);
    expect(body<StockTransferBody>(requested).status).toBe(StockTransferStatus.REQUESTED);
    // No inventory effect yet.
    expect((await inventoryAt(productId, sourceLocationId)).quantity).toBe(10);
    expect((await inventoryAt(productId, sourceLocationId)).reservedQuantity).toBe(0);

    const approved = await post(`/api/v1/stock-transfers/${transfer.id}/approve`).expect(200);
    expect(body<StockTransferBody>(approved).status).toBe(StockTransferStatus.APPROVED);
    // Reserved at the source, but nothing physically moved yet.
    expect((await inventoryAt(productId, sourceLocationId)).quantity).toBe(10);
    expect((await inventoryAt(productId, sourceLocationId)).reservedQuantity).toBe(6);
    expect((await inventoryAt(productId, destinationLocationId)).quantity).toBe(0);

    const shipped = await post(`/api/v1/stock-transfers/${transfer.id}/ship`).expect(200);
    expect(body<StockTransferBody>(shipped).status).toBe(StockTransferStatus.IN_TRANSIT);
    // Stock has left the source; not yet arrived at the destination - conserved
    // across both locations combined (4 + 0, with 6 in transit accounted for
    // by the fact source dropped from 10 to 4).
    expect((await inventoryAt(productId, sourceLocationId)).quantity).toBe(4);
    expect((await inventoryAt(productId, sourceLocationId)).reservedQuantity).toBe(0);
    expect((await inventoryAt(productId, destinationLocationId)).quantity).toBe(0);

    const completed = await post(`/api/v1/stock-transfers/${transfer.id}/complete`).expect(200);
    expect(body<StockTransferBody>(completed).status).toBe(StockTransferStatus.COMPLETED);
    expect((await inventoryAt(productId, sourceLocationId)).quantity).toBe(4);
    expect((await inventoryAt(productId, destinationLocationId)).quantity).toBe(6);

    // Total quantity across both locations combined is unchanged by the transfer.
    const sourceQty = (await inventoryAt(productId, sourceLocationId)).quantity;
    const destQty = (await inventoryAt(productId, destinationLocationId)).quantity;
    expect(sourceQty + destQty).toBe(10);

    // Exactly two StockMovement rows: one TRANSFER_OUT, one TRANSFER_IN.
    const movements = await context.prisma.stockMovement.findMany({
      where: { productId, referenceType: StockReferenceType.TRANSFER, referenceId: transfer.id },
    });
    expect(movements).toHaveLength(2);
    expect(movements.find((m) => m.type === StockMovementType.TRANSFER_OUT)?.locationId).toBe(sourceLocationId);
    expect(movements.find((m) => m.type === StockMovementType.TRANSFER_IN)?.locationId).toBe(destinationLocationId);
    expect(movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(12);
  });

  it('releases the source reservation when a transfer is cancelled after approval', async () => {
    const productId = await makeProduct('CANCELAFTERAPPROVE');
    await stockAt(productId, sourceLocationId, 5);

    const created = await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId,
      items: [{ productId, quantity: 3 }],
    }).expect(201);
    const transfer = body<StockTransferBody>(created);

    await post(`/api/v1/stock-transfers/${transfer.id}/request`).expect(200);
    await post(`/api/v1/stock-transfers/${transfer.id}/approve`).expect(200);
    expect((await inventoryAt(productId, sourceLocationId)).reservedQuantity).toBe(3);

    const cancelled = await post(`/api/v1/stock-transfers/${transfer.id}/cancel`).expect(200);
    expect(body<StockTransferBody>(cancelled).status).toBe(StockTransferStatus.CANCELLED);
    expect((await inventoryAt(productId, sourceLocationId)).reservedQuantity).toBe(0);
    expect((await inventoryAt(productId, sourceLocationId)).quantity).toBe(5);
  });

  it('cancels a draft with no inventory effect', async () => {
    const productId = await makeProduct('CANCELDRAFT');
    const created = await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId,
      items: [{ productId, quantity: 1 }],
    }).expect(201);
    const transfer = body<StockTransferBody>(created);

    const cancelled = await post(`/api/v1/stock-transfers/${transfer.id}/cancel`).expect(200);
    expect(body<StockTransferBody>(cancelled).status).toBe(StockTransferStatus.CANCELLED);
  });

  it('refuses to cancel once shipped (IN_TRANSIT) or completed', async () => {
    const productId = await makeProduct('CANCELAFTERSHIP');
    await stockAt(productId, sourceLocationId, 5);

    const created = await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId,
      items: [{ productId, quantity: 2 }],
    }).expect(201);
    const transfer = body<StockTransferBody>(created);

    await post(`/api/v1/stock-transfers/${transfer.id}/request`).expect(200);
    await post(`/api/v1/stock-transfers/${transfer.id}/approve`).expect(200);
    await post(`/api/v1/stock-transfers/${transfer.id}/ship`).expect(200);

    await post(`/api/v1/stock-transfers/${transfer.id}/cancel`).expect(409);

    await post(`/api/v1/stock-transfers/${transfer.id}/complete`).expect(200);
    await post(`/api/v1/stock-transfers/${transfer.id}/cancel`).expect(409);
  });

  it('refuses a transfer between the same location', async () => {
    const productId = await makeProduct('SAMELOCATION');

    await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId: sourceLocationId,
      items: [{ productId, quantity: 1 }],
    }).expect(422);
  });

  it('freezes lines once approved', async () => {
    const productId = await makeProduct('FREEZE');
    await stockAt(productId, sourceLocationId, 5);

    const created = await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId,
      items: [{ productId, quantity: 2 }],
    }).expect(201);
    const transfer = body<StockTransferBody>(created);

    await post(`/api/v1/stock-transfers/${transfer.id}/request`).expect(200);
    await post(`/api/v1/stock-transfers/${transfer.id}/approve`).expect(200);

    await post(`/api/v1/stock-transfers/${transfer.id}/items`, { productId: await makeProduct('FREEZE2'), quantity: 1 }).expect(409);
  });

  it('refuses to approve a transfer that would over-reserve the source location', async () => {
    const productId = await makeProduct('INSUFFICIENT');
    await stockAt(productId, sourceLocationId, 2);

    const created = await post('/api/v1/stock-transfers', {
      sourceLocationId,
      destinationLocationId,
      items: [{ productId, quantity: 5 }],
    }).expect(201);
    const transfer = body<StockTransferBody>(created);

    await post(`/api/v1/stock-transfers/${transfer.id}/request`).expect(200);
    await post(`/api/v1/stock-transfers/${transfer.id}/approve`).expect(409);
  });
});
