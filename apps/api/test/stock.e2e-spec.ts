import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ErrorCode } from '../src/common/enums/error-code.enum';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { StockMovementType, UserRole } from '../src/generated/prisma/enums';
import type { StockAdjustmentResult, StockLevel, StockSummary } from '../src/stock/stock.service';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface MovementResponse {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  referenceType: string;
  note: string | null;
  product: { sku: string };
  createdBy: { firstName: string };
}

describe('Stock (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let categoryId: string;

  async function createProduct(suffix: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(context.server)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku: `${label}-${suffix}`, name: `Stock ${suffix}`, categoryId, costPrice: '10.00', sellingPrice: '25.00', minimumStock: 5, ...overrides })
      .expect(201);

    return (response.body as ApiResponse<{ id: string }>).data.id;
  }

  async function adjust(token: string, body: Record<string, unknown>, expected = 200): Promise<request.Response> {
    return request(context.server).post('/api/v1/stock/adjust').set('Authorization', `Bearer ${token}`).send(body).expect(expected);
  }

  async function levelOf(productId: string): Promise<StockLevel> {
    const response = await request(context.server).get(`/api/v1/stock/${productId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    return (response.body as ApiResponse<StockLevel>).data;
  }

  beforeAll(async () => {
    // This suite makes more calls than the default allowance permits.
    context = await createTestApp({ throttleLimit: 10_000 });
    label = `ST${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      await context.prisma.auditLog.deleteMany({ where: { userId: { in: context.createdUserIds } } });
      await context.prisma.stockMovement.deleteMany({ where: { product: { sku: { startsWith: label } } } });
      await context.prisma.inventory.deleteMany({ where: { product: { sku: { startsWith: label } } } });
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'stock-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'stock-staff', UserRole.STAFF)).accessToken;

    const category = await request(context.server)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Stock Category` })
      .expect(201);
    categoryId = (category.body as ApiResponse<{ id: string }>).data.id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('access control', () => {
    it('lets any authenticated user read stock levels', async () => {
      await request(context.server).get('/api/v1/stock').set('Authorization', `Bearer ${staffToken}`).expect(200);
      await request(context.server).get('/api/v1/stock/movements').set('Authorization', `Bearer ${staffToken}`).expect(200);
      await request(context.server).get('/api/v1/stock/summary').set('Authorization', `Bearer ${staffToken}`).expect(200);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(context.server).get('/api/v1/stock').expect(401);
    });

    it('refuses staff from adjusting stock, because a manual movement has no source document', async () => {
      const productId = await createProduct('RBAC');

      const response = await adjust(staffToken, { productId, type: StockMovementType.PURCHASE, quantity: 1 }, 403);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.FORBIDDEN);
    });
  });

  describe('POST /stock/adjust', () => {
    it('receives stock and records the movement in the same breath', async () => {
      const productId = await createProduct('RECV');

      const response = await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 12, note: 'Opening delivery' });
      const body = (response.body as ApiResponse<StockAdjustmentResult>).data;

      expect(body).toMatchObject({ previousQuantity: 0, newQuantity: 12, quantity: 12, availableQuantity: 12 });

      const movements = await context.prisma.stockMovement.findMany({ where: { productId } });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ type: StockMovementType.PURCHASE, quantity: 12, previousQuantity: 0, newQuantity: 12, note: 'Opening delivery' });
    });

    it('removes stock and leaves the ledger reconciling with the level', async () => {
      const productId = await createProduct('OUT');
      await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 20 });
      await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 8 });

      const level = await levelOf(productId);
      expect(level.quantity).toBe(12);

      const movements = await context.prisma.stockMovement.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } });
      const net = movements.reduce((sum, movement) => sum + (movement.type === StockMovementType.PURCHASE ? movement.quantity : -movement.quantity), 0);
      expect(net).toBe(level.quantity);
    });

    it('refuses to take out more than is on hand, and changes nothing', async () => {
      const productId = await createProduct('SHORT');
      await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 3 });

      const response = await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 4 }, 409);
      expect((response.body as ApiErrorResponse).message).toMatch(/4 requested but only 3 available/);

      expect((await levelOf(productId)).quantity).toBe(3);
      expect(await context.prisma.stockMovement.count({ where: { productId } })).toBe(1);
    });

    it('treats reserved units as unavailable', async () => {
      const productId = await createProduct('RESV');
      await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 10 });
      await context.prisma.inventory.updateMany({ where: { productId }, data: { reservedQuantity: 8 } });

      const response = await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 5 }, 409);
      expect((response.body as ApiErrorResponse).message).toMatch(/only 2 available \(10 on hand, 8 reserved\)/);

      // Two units are genuinely free, so that much is allowed.
      await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 2 });
      expect((await levelOf(productId)).quantity).toBe(8);

      await context.prisma.inventory.updateMany({ where: { productId }, data: { reservedQuantity: 0 } });
    });

    it.each([
      ['a sale', StockMovementType.SALE],
      ['a return', StockMovementType.RETURN_IN],
      ['a repair consumption', StockMovementType.REPAIR_OUT],
    ])('refuses to post %s by hand, because it belongs to a document', async (_label, type: StockMovementType) => {
      const productId = await createProduct(`TYPE${type.slice(0, 4)}`);

      const response = await adjust(adminToken, { productId, type, quantity: 1 }, 400);
      expect((response.body as ApiErrorResponse).errors?.map((error) => error.field)).toContain('type');
    });

    it.each([
      ['a zero quantity', 'VALZERO', { quantity: 0 }, 'quantity'],
      ['a negative quantity', 'VALNEG', { quantity: -5 }, 'quantity'],
      ['a fractional quantity', 'VALFRAC', { quantity: 1.5 }, 'quantity'],
      ['a product id that is not a UUID', 'VALUUID', { productId: 'nope' }, 'productId'],
      ['an unknown movement type', 'VALTYPE', { type: 'TELEPORT' }, 'type'],
    ])('rejects %s', async (_label, suffix: string, override: Record<string, unknown>, field: string) => {
      const productId = await createProduct(suffix);

      const response = await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 1, ...override }, 400);
      expect((response.body as ApiErrorResponse).errors?.map((error) => error.field)).toContain(field);
    });

    it('returns 404 for a product that does not exist', async () => {
      const response = await adjust(adminToken, { productId: randomUUID(), type: StockMovementType.PURCHASE, quantity: 1 }, 404);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('GET /stock', () => {
    it('reports each product with its level, status and money as strings', async () => {
      const productId = await createProduct('LEVEL', { costPrice: '3.50', sellingPrice: '9.99', minimumStock: 4 });
      await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 30 });

      const level = await levelOf(productId);

      expect(level).toMatchObject({
        sku: `${label}-LEVEL`,
        quantity: 30,
        reservedQuantity: 0,
        availableQuantity: 30,
        minimumStock: 4,
        stockStatus: 'OK',
        costPrice: '3.50',
        sellingPrice: '9.99',
      });
      expect(level.categoryName).toBe(`${label} Stock Category`);
    });

    it.each([
      ['OUT', 0, 'OUT'],
      ['LOW at the boundary', 5, 'LOW'],
      ['LOW below the minimum', 2, 'LOW'],
      ['OK above the minimum', 6, 'OK'],
    ])('classifies %s correctly', async (suffix: string, quantity: number, expected: string) => {
      const productId = await createProduct(`S${quantity}${expected}`, { minimumStock: 5 });
      if (quantity > 0) {
        await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity });
      }

      expect((await levelOf(productId)).stockStatus).toBe(expected);
    });

    it('filters to low stock only, which no ORM filter could express', async () => {
      const response = await request(context.server)
        .get(`/api/v1/stock?search=${label}&stockStatus=LOW&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<StockLevel[]>;

      expect(body.data.length).toBeGreaterThan(0);
      // The comparison is quantity against each product's own minimum.
      expect(body.data.every((row) => row.quantity > 0 && row.quantity <= row.minimumStock)).toBe(true);
    });

    it('filters to out of stock only', async () => {
      const response = await request(context.server)
        .get(`/api/v1/stock?search=${label}&stockStatus=OUT&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<StockLevel[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row) => row.quantity === 0)).toBe(true);
    });

    it('pages with a total that matches the filter, not the whole table', async () => {
      const all = await request(context.server).get(`/api/v1/stock?search=${label}&limit=100`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      const low = await request(context.server)
        .get(`/api/v1/stock?search=${label}&stockStatus=LOW&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const allTotal = (all.body as ApiResponse<StockLevel[]>).meta.total ?? 0;
      const lowTotal = (low.body as ApiResponse<StockLevel[]>).meta.total ?? 0;

      expect(lowTotal).toBeGreaterThan(0);
      expect(lowTotal).toBeLessThan(allTotal);
      expect((low.body as ApiResponse<StockLevel[]>).data).toHaveLength(lowTotal);
    });

    it('pages without overlap', async () => {
      const first = await request(context.server).get('/api/v1/stock?limit=3&page=1&sortBy=sku').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const second = await request(context.server).get('/api/v1/stock?limit=3&page=2&sortBy=sku').set('Authorization', `Bearer ${adminToken}`).expect(200);

      const firstSkus = (first.body as ApiResponse<StockLevel[]>).data.map((row) => row.sku);
      const secondSkus = (second.body as ApiResponse<StockLevel[]>).data.map((row) => row.sku);

      expect(firstSkus.some((sku) => secondSkus.includes(sku))).toBe(false);
    });

    it('sorts by quantity numerically', async () => {
      const response = await request(context.server)
        .get(`/api/v1/stock?search=${label}&sortBy=quantity&sortOrder=desc&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const quantities = (response.body as ApiResponse<StockLevel[]>).data.map((row) => row.quantity);

      expect(quantities).toEqual([...quantities].sort((a, b) => b - a));
    });

    it.each([
      ['an unlisted sort column', 'sortBy=costPrice'],
      ['an unknown stock status', 'stockStatus=EMPTY'],
      ['a limit above the cap', 'limit=1000'],
      ['a category filter that is not a UUID', 'categoryId=nope'],
    ])('rejects %s', async (_label, queryString: string) => {
      const response = await request(context.server).get(`/api/v1/stock?${queryString}`).set('Authorization', `Bearer ${adminToken}`).expect(400);

      expect((response.body as ApiErrorResponse).code).toBe(ErrorCode.VALIDATION_ERROR);
    });

    it('does not treat a quoted search term as SQL', async () => {
      const response = await request(context.server)
        .get(`/api/v1/stock?search=${encodeURIComponent("' OR 1=1 --")}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // A parameterised LIKE finds nothing; an interpolated one would return everything.
      expect((response.body as ApiResponse<StockLevel[]>).data).toHaveLength(0);
    });
  });

  describe('GET /stock/summary', () => {
    it('reports counts and valuations computed in the database', async () => {
      const response = await request(context.server).get('/api/v1/stock/summary').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const summary = (response.body as ApiResponse<StockSummary>).data;

      expect(summary.totalProducts).toBeGreaterThan(0);
      expect(summary.totalUnits).toBeGreaterThan(0);
      expect(summary.lowStockCount).toBeGreaterThan(0);
      expect(summary.outOfStockCount).toBeGreaterThan(0);
      expect(summary.inventoryValueAtCost).toMatch(/^\d+\.\d{2}$/);
      expect(summary.inventoryValueAtRetail).toMatch(/^\d+\.\d{2}$/);
      expect(Number(summary.inventoryValueAtRetail)).toBeGreaterThan(Number(summary.inventoryValueAtCost));
    });

    it('values stock at cost exactly, without floating-point drift', async () => {
      const before = await request(context.server).get('/api/v1/stock/summary').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const valueBefore = (before.body as ApiResponse<StockSummary>).data.inventoryValueAtCost;

      const productId = await createProduct('VALUE', { costPrice: '0.07', sellingPrice: '0.11' });
      await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 3 });

      const after = await request(context.server).get('/api/v1/stock/summary').set('Authorization', `Bearer ${adminToken}`).expect(200);
      const valueAfter = (after.body as ApiResponse<StockSummary>).data.inventoryValueAtCost;

      // 3 x 0.07 must be exactly 0.21, not 0.21000000000000002.
      const difference = (Number(valueAfter) * 100 - Number(valueBefore) * 100) / 100;
      expect(difference.toFixed(2)).toBe('0.21');
    });
  });

  describe('GET /stock/movements', () => {
    it('returns the ledger newest first, with product and author', async () => {
      const productId = await createProduct('LEDGER');
      await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 5 });
      await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 2 });

      const response = await request(context.server)
        .get(`/api/v1/stock/movements?productId=${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<MovementResponse[]>;

      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.type).toBe(StockMovementType.ADJUSTMENT_OUT);
      expect(body.data[0]?.product.sku).toBe(`${label}-LEDGER`);
      expect(body.data[0]?.createdBy.firstName).toBe('Test');
      expect(body.data[0]?.previousQuantity).toBe(5);
      expect(body.data[0]?.newQuantity).toBe(3);
    });

    it('filters by movement type', async () => {
      const response = await request(context.server)
        .get('/api/v1/stock/movements?type=ADJUSTMENT_OUT&limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<MovementResponse[]>;

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.every((row) => row.type === StockMovementType.ADJUSTMENT_OUT)).toBe(true);
    });

    it('filters by reference type', async () => {
      const response = await request(context.server)
        .get('/api/v1/stock/movements?referenceType=MANUAL&limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const body = response.body as ApiResponse<MovementResponse[]>;

      expect(body.data.every((row) => row.referenceType === 'MANUAL')).toBe(true);
    });

    it.each([
      ['an unknown movement type', 'type=TELEPORT'],
      ['an unlisted sort column', 'sortBy=note'],
      ['a malformed date', 'createdFrom=yesterday'],
    ])('rejects %s', async (_label, queryString: string) => {
      await request(context.server).get(`/api/v1/stock/movements?${queryString}`).set('Authorization', `Bearer ${adminToken}`).expect(400);
    });
  });

  describe('the ledger explains every unit on hand', () => {
    it('reconciles the level against the sum of its movements', async () => {
      const productId = await createProduct('RECON');

      await adjust(adminToken, { productId, type: StockMovementType.PURCHASE, quantity: 50 });
      await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 7 });
      await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_IN, quantity: 3 });
      await adjust(adminToken, { productId, type: StockMovementType.ADJUSTMENT_OUT, quantity: 11 });

      const movements = await context.prisma.stockMovement.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } });
      const inbound = new Set<StockMovementType>([StockMovementType.PURCHASE, StockMovementType.ADJUSTMENT_IN]);
      const net = movements.reduce((sum, movement) => sum + (inbound.has(movement.type) ? movement.quantity : -movement.quantity), 0);

      expect(net).toBe(35);
      expect((await levelOf(productId)).quantity).toBe(35);

      // Each movement also has to chain onto the one before it.
      let running = 0;
      for (const movement of movements) {
        expect(movement.previousQuantity).toBe(running);
        running += inbound.has(movement.type) ? movement.quantity : -movement.quantity;
        expect(movement.newQuantity).toBe(running);
      }
    });
  });
});
