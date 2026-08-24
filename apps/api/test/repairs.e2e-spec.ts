import request from 'supertest';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { DeviceType, PaymentMethod, RepairStatus, StockMovementType, StockReferenceType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

interface RepairBody {
  id: string;
  repairNumber: string;
  status: RepairStatus;
  customerId: string;
  technicianId: string | null;
  deviceType: DeviceType;
  serialNumber: string | null;
  imei: string | null;
  estimatedCost: string | null;
  finalCost: string | null;
  completedAt: string | null;
  partsTotal: string;
  paidAmount: string;
  outstanding: string | null;
  items: { id: string; productId: string; quantity: number; unitPrice: string; total: string }[];
  payments: { id: string; amount: string }[];
  statusHistory: { fromStatus: RepairStatus | null; toStatus: RepairStatus; note: string | null; changedById: string }[];
}

interface StockLevelBody {
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

function errorMessage(response: request.Response): string {
  return (response.body as ApiErrorResponse).message;
}

describe('Repairs (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let technicianToken: string;
  let technicianId: string;
  let staffId: string;
  let categoryId: string;
  let customerId: string;

  const INTAKE = { deviceType: DeviceType.PHONE, problemDescription: 'Screen cracked after a drop' };

  async function makePart(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
    const created = await request(context.server)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku: `${label}-${suffix}`, name: `Part ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
      .expect(201);

    const productId = body<Identified>(created).id;

    if (quantity > 0) {
      await request(context.server)
        .post('/api/v1/stock/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ productId, type: StockMovementType.PURCHASE, quantity })
        .expect(200);
    }

    return productId;
  }

  async function stockOf(productId: string): Promise<StockLevelBody> {
    const response = await request(context.server).get(`/api/v1/stock/${productId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);

    return body<StockLevelBody>(response);
  }

  async function intake(extra: Record<string, unknown> = {}): Promise<RepairBody> {
    const response = await request(context.server)
      .post('/api/v1/repairs')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ customerId, ...INTAKE, ...extra })
      .expect(201);

    return body<RepairBody>(response);
  }

  async function moveTo(id: string, toStatus: RepairStatus, note?: string): Promise<RepairBody> {
    const response = await request(context.server)
      .post(`/api/v1/repairs/${id}/status`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ toStatus, ...(note === undefined ? {} : { note }) })
      .expect(200);

    return body<RepairBody>(response);
  }

  /** Walks a fresh repair up to IN_PROGRESS, where parts get fitted. */
  async function onTheBench(extra: Record<string, unknown> = {}): Promise<RepairBody> {
    const repair = await intake(extra);

    await moveTo(repair.id, RepairStatus.DIAGNOSING);
    await moveTo(repair.id, RepairStatus.APPROVED);

    return moveTo(repair.id, RepairStatus.IN_PROGRESS);
  }

  beforeAll(async () => {
    // A repair takes four requests to reach the bench before a test can even
    // begin, so this suite puts through more than the production per-address
    // allowance in the minute it runs. The limiter has its own test.
    context = await createTestApp({ throttleLimit: 5000 });
    label = `RP${context.run.slice(0, 5).toUpperCase()}`;

    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });

      await context.prisma.financialTransaction.deleteMany({ where: { createdById } });
      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.repairStatusHistory.deleteMany({ where: { changedById: createdById } });
      await context.prisma.repair.deleteMany({ where: { customer: { customerCode: { startsWith: label } } } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      // Inventory cascades from Product, so deleting it separately only risks
      // stranding products without a stock row if a later delete fails.
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    const admin = await signInAs(context, 'rep-admin', UserRole.ADMIN);
    const staff = await signInAs(context, 'rep-staff', UserRole.STAFF);
    const technician = await signInAs(context, 'rep-tech', UserRole.TECHNICIAN);

    adminToken = admin.accessToken;
    staffToken = staff.accessToken;
    staffId = staff.id;
    technicianToken = technician.accessToken;
    technicianId = technician.id;

    const category = await request(context.server)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Parts` })
      .expect(201);
    categoryId = body<Identified>(category).id;

    const customer = await request(context.server)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerCode: `${label}-C1`, firstName: 'Repair', lastName: 'Customer', phone: '+1 555 0111' })
      .expect(201);
    customerId = body<Identified>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('intake', () => {
    it('takes a device in as RECEIVED with a document number', async () => {
      const repair = await intake();

      expect(repair.status).toBe(RepairStatus.RECEIVED);
      expect(repair.repairNumber).toMatch(/^REP-\d{8}$/);
      expect(repair.completedAt).toBeNull();
    });

    it('opens the history with a row that came from nowhere', async () => {
      const repair = await intake();

      expect(repair.statusHistory).toHaveLength(1);
      expect(repair.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: RepairStatus.RECEIVED, changedById: staffId });
    });

    it('gives every repair a different number', async () => {
      const [first, second] = await Promise.all([intake(), intake()]);

      expect(first.repairNumber).not.toBe(second.repairNumber);
    });

    it('upper-cases the serial and IMEI so a device is found however it was typed', async () => {
      const repair = await intake({ serialNumber: 'sn-abc123', imei: 'ab12cd34' });

      expect(repair.serialNumber).toBe('SN-ABC123');
      expect(repair.imei).toBe('AB12CD34');
    });

    it('accepts a repair nobody has picked up yet', async () => {
      const repair = await intake();

      expect(repair.technicianId).toBeNull();
    });

    it('assigns a technician when one is named', async () => {
      const repair = await intake({ technicianId });

      expect(repair.technicianId).toBe(technicianId);
    });

    it('refuses to assign a repair to a salesperson', async () => {
      const response = await request(context.server)
        .post('/api/v1/repairs')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId, ...INTAKE, technicianId: staffId })
        .expect(422);

      expect(errorMessage(response)).toMatch(/active technician, manager or administrator/);
    });

    it('refuses a customer who does not exist', async () => {
      await request(context.server)
        .post('/api/v1/repairs')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId: '00000000-0000-4000-8000-00000000dead', ...INTAKE })
        .expect(404);
    });

    it('insists on knowing what is wrong', async () => {
      await request(context.server)
        .post('/api/v1/repairs')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId, deviceType: DeviceType.PHONE })
        .expect(400);
    });

    it('rejects a device type it has never heard of', async () => {
      await request(context.server)
        .post('/api/v1/repairs')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId, ...INTAKE, deviceType: 'HOVERBOARD' })
        .expect(400);
    });

    it('rejects an estimate with three decimal places', async () => {
      await request(context.server)
        .post('/api/v1/repairs')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId, ...INTAKE, estimatedCost: '10.001' })
        .expect(400);
    });
  });

  describe('the workflow', () => {
    it('walks an ordinary job from intake to hand-over', async () => {
      const repair = await intake();

      for (const status of [RepairStatus.DIAGNOSING, RepairStatus.WAITING_APPROVAL, RepairStatus.APPROVED, RepairStatus.IN_PROGRESS]) {
        expect((await moveTo(repair.id, status)).status).toBe(status);
      }

      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '120.00' })
        .expect(200);

      const completed = await moveTo(repair.id, RepairStatus.COMPLETED);
      const delivered = await moveTo(repair.id, RepairStatus.DELIVERED);

      expect(completed.completedAt).not.toBeNull();
      expect(delivered.status).toBe(RepairStatus.DELIVERED);
      expect(delivered.statusHistory).toHaveLength(7);
    });

    it('records every move with who made it and why', async () => {
      const repair = await intake();
      const moved = await moveTo(repair.id, RepairStatus.DIAGNOSING, 'Booked onto the bench');

      expect(moved.statusHistory[1]).toMatchObject({
        fromStatus: RepairStatus.RECEIVED,
        toStatus: RepairStatus.DIAGNOSING,
        note: 'Booked onto the bench',
        changedById: technicianId,
      });
    });

    it('refuses to skip the middle of the workflow', async () => {
      const repair = await intake();

      const response = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.COMPLETED })
        .expect(409);

      expect(errorMessage(response)).toMatch(/A RECEIVED repair cannot become COMPLETED; it can only become DIAGNOSING or CANCELLED/);
    });

    it('writes no history row for a refused move', async () => {
      const repair = await intake();

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.DELIVERED })
        .expect(409);

      const after = await request(context.server).get(`/api/v1/repairs/${repair.id}`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      expect(body<RepairBody>(after).statusHistory).toHaveLength(1);
    });

    it('lets a job wait for parts and come back', async () => {
      const repair = await onTheBench();

      expect((await moveTo(repair.id, RepairStatus.WAITING_PARTS)).status).toBe(RepairStatus.WAITING_PARTS);
      expect((await moveTo(repair.id, RepairStatus.IN_PROGRESS)).status).toBe(RepairStatus.IN_PROGRESS);
    });

    it('refuses to complete a repair nobody has priced', async () => {
      const repair = await onTheBench();

      const response = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.COMPLETED })
        .expect(422);

      expect(errorMessage(response)).toMatch(/Set the final cost before completing/);
    });

    it('treats a delivered repair as final', async () => {
      const repair = await onTheBench();
      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '0.00' })
        .expect(200);
      await moveTo(repair.id, RepairStatus.COMPLETED);
      await moveTo(repair.id, RepairStatus.DELIVERED);

      const response = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.IN_PROGRESS })
        .expect(409);

      expect(errorMessage(response)).toMatch(/is DELIVERED, which is final/);
    });

    it('refuses to cancel work that is already finished', async () => {
      const repair = await onTheBench();
      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '55.00' })
        .expect(200);
      await moveTo(repair.id, RepairStatus.COMPLETED);

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/status`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ toStatus: RepairStatus.CANCELLED })
        .expect(409);
    });

    it('closes a completed repair to further changes', async () => {
      const repair = await onTheBench();
      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '55.00' })
        .expect(200);
      await moveTo(repair.id, RepairStatus.COMPLETED);

      const response = await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ diagnosis: 'Changed my mind' })
        .expect(409);

      expect(errorMessage(response)).toMatch(/is COMPLETED and can no longer be changed/);
    });
  });

  describe('parts', () => {
    it('reserves a part rather than taking it off the shelf', async () => {
      const productId = await makePart('RESERVE', '30.00', 10);
      const repair = await onTheBench();

      const updated = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 3 })
        .expect(200);

      const stock = await stockOf(productId);
      expect(body<RepairBody>(updated).partsTotal).toBe('90.00');
      expect(stock.quantity).toBe(10);
      expect(stock.reservedQuantity).toBe(3);
      expect(stock.availableQuantity).toBe(7);
    });

    it('writes no movement until the repair is finished', async () => {
      const productId = await makePart('NOMOVE', '30.00', 10);
      const repair = await onTheBench();

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 2 })
        .expect(200);

      expect(await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.REPAIR_OUT } })).toBe(0);
    });

    it('takes the parts out of stock on completion and says why', async () => {
      const productId = await makePart('CONSUME', '30.00', 10);
      const repair = await onTheBench();

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 4 })
        .expect(200);
      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '150.00' })
        .expect(200);
      await moveTo(repair.id, RepairStatus.COMPLETED);

      const stock = await stockOf(productId);
      const movements = await context.prisma.stockMovement.findMany({ where: { productId, type: StockMovementType.REPAIR_OUT } });

      expect(stock.quantity).toBe(6);
      expect(stock.reservedQuantity).toBe(0);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        quantity: 4,
        previousQuantity: 10,
        newQuantity: 6,
        referenceType: StockReferenceType.REPAIR,
        referenceId: repair.id,
      });
    });

    it('gives the parts back when the job is cancelled', async () => {
      const productId = await makePart('CANCELPART', '30.00', 10);
      const repair = await onTheBench();

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 5 })
        .expect(200);
      await moveTo(repair.id, RepairStatus.CANCELLED, 'Customer collected it unrepaired');

      const stock = await stockOf(productId);
      expect(stock.quantity).toBe(10);
      expect(stock.reservedQuantity).toBe(0);
      expect(await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.REPAIR_OUT } })).toBe(0);
    });

    it('claims only the difference when a quantity goes up', async () => {
      const productId = await makePart('MORE', '30.00', 10);
      const repair = await onTheBench();

      const added = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 2 })
        .expect(200);

      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}/items/${body<RepairBody>(added).items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ quantity: 6 })
        .expect(200);

      expect((await stockOf(productId)).reservedQuantity).toBe(6);
    });

    it('gives back the difference when a quantity goes down', async () => {
      const productId = await makePart('FEWER', '30.00', 10);
      const repair = await onTheBench();

      const added = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 6 })
        .expect(200);

      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}/items/${body<RepairBody>(added).items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ quantity: 2 })
        .expect(200);

      expect((await stockOf(productId)).reservedQuantity).toBe(2);
    });

    it('gives the whole claim back when a part comes off', async () => {
      const productId = await makePart('REMOVE', '30.00', 10);
      const repair = await onTheBench();

      const added = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 4 })
        .expect(200);

      const removed = await request(context.server)
        .delete(`/api/v1/repairs/${repair.id}/items/${body<RepairBody>(added).items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);

      expect(body<RepairBody>(removed).items).toHaveLength(0);
      expect((await stockOf(productId)).reservedQuantity).toBe(0);
    });

    it('refuses a part there is not enough of, and reserves nothing', async () => {
      const productId = await makePart('SHORT', '30.00', 2);
      const repair = await onTheBench();

      const response = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 5 })
        .expect(409);

      expect(errorMessage(response)).toMatch(/2 available/);
      expect((await stockOf(productId)).reservedQuantity).toBe(0);
    });

    it('refuses the same part twice', async () => {
      const productId = await makePart('DUP', '30.00', 10);
      const repair = await onTheBench();

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 1 })
        .expect(200);

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 1 })
        .expect(409);
    });

    it('refuses to fit parts to a finished repair', async () => {
      const productId = await makePart('LATE', '30.00', 10);
      const repair = await onTheBench();
      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '20.00' })
        .expect(200);
      await moveTo(repair.id, RepairStatus.COMPLETED);

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 1 })
        .expect(409);
    });

    it('refuses a part from another repair', async () => {
      const productId = await makePart('MINE', '30.00', 10);
      const mine = await onTheBench();
      const theirs = await onTheBench();

      const added = await request(context.server)
        .post(`/api/v1/repairs/${theirs.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 1 })
        .expect(200);

      await request(context.server)
        .delete(`/api/v1/repairs/${mine.id}/items/${body<RepairBody>(added).items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(404);
    });

    it('is exact where floating point is not', async () => {
      const productId = await makePart('PENNY', '0.07', 10);
      const repair = await onTheBench();

      const updated = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ productId, quantity: 3 })
        .expect(200);

      expect(body<RepairBody>(updated).partsTotal).toBe('0.21');
    });
  });

  describe('payments', () => {
    async function completedRepair(finalCost: string): Promise<RepairBody> {
      const repair = await onTheBench();
      await request(context.server).patch(`/api/v1/repairs/${repair.id}`).set('Authorization', `Bearer ${technicianToken}`).send({ finalCost }).expect(200);

      return moveTo(repair.id, RepairStatus.COMPLETED);
    }

    it('leaves what is owed unknown until the repair is priced', async () => {
      const repair = await onTheBench();

      expect(repair.finalCost).toBeNull();
      expect(repair.outstanding).toBeNull();
    });

    it('records a part payment and reports what is left', async () => {
      const repair = await completedRepair('150.00');

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '50.00' })
        .expect(201);

      const after = await request(context.server).get(`/api/v1/repairs/${repair.id}`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      expect(body<RepairBody>(after)).toMatchObject({ paidAmount: '50.00', outstanding: '100.00' });
    });

    it('gives every payment a document number', async () => {
      const repair = await completedRepair('40.00');

      const response = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CARD, amount: '40.00' })
        .expect(201);

      expect(body<{ paymentNumber: string }>(response).paymentNumber).toMatch(/^PAY-\d{8}$/);
    });

    it('refuses more than is outstanding, and records nothing', async () => {
      const repair = await completedRepair('40.00');

      const response = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '40.01' })
        .expect(409);

      expect(errorMessage(response)).toMatch(/more than the 40.00 outstanding/);
      expect(await context.prisma.payment.count({ where: { repairId: repair.id } })).toBe(0);
    });

    it('counts what has already been taken', async () => {
      const repair = await completedRepair('40.00');

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '30.00' })
        .expect(201);

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '15.00' })
        .expect(409);
    });

    it('refuses payment before the work is done', async () => {
      const repair = await onTheBench();

      const response = await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '10.00' })
        .expect(409);

      expect(errorMessage(response)).toMatch(/payment can only be recorded once it is completed and priced/);
    });

    it('accepts payment after the device has gone back', async () => {
      const repair = await completedRepair('25.00');
      await moveTo(repair.id, RepairStatus.DELIVERED);

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.BANK_TRANSFER, amount: '25.00' })
        .expect(201);
    });

    it('rejects an amount of nothing', async () => {
      const repair = await completedRepair('25.00');

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '0.00' })
        .expect(400);
    });

    it('lists the payments taken against a repair', async () => {
      const repair = await completedRepair('30.00');

      for (const amount of ['10.00', '5.00']) {
        await request(context.server)
          .post(`/api/v1/repairs/${repair.id}/payments`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ method: PaymentMethod.CASH, amount })
          .expect(201);
      }

      const response = await request(context.server).get(`/api/v1/repairs/${repair.id}/payments`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      expect(body<{ amount: string }[]>(response).map((payment) => payment.amount)).toEqual(['10.00', '5.00']);
    });
  });

  describe('the workbench listing', () => {
    it('paginates', async () => {
      const response = await request(context.server).get('/api/v1/repairs?page=1&limit=2').set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<RepairBody[]>(response).length).toBeLessThanOrEqual(2);
      expect((response.body as ApiResponse<RepairBody[]>).meta.limit).toBe(2);
    });

    it('finds a device by its serial number', async () => {
      const repair = await intake({ serialNumber: `${label}SERIAL` });

      const response = await request(context.server).get(`/api/v1/repairs?search=${label}SERIAL`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<RepairBody[]>(response).map((row) => row.id)).toEqual([repair.id]);
    });

    it('finds a device by its IMEI', async () => {
      const repair = await intake({ imei: `${label}IMEI` });

      const response = await request(context.server).get(`/api/v1/repairs?search=${label}IMEI`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<RepairBody[]>(response).map((row) => row.id)).toEqual([repair.id]);
    });

    it('narrows to work still on the bench', async () => {
      const response = await request(context.server).get('/api/v1/repairs?openOnly=true&limit=100').set('Authorization', `Bearer ${staffToken}`).expect(200);

      const finished: RepairStatus[] = [RepairStatus.COMPLETED, RepairStatus.DELIVERED, RepairStatus.CANCELLED];
      expect(body<RepairBody[]>(response).every((row) => !finished.includes(row.status))).toBe(true);
    });

    it('narrows to jobs whose promised date has gone by', async () => {
      const late = await intake({ expectedCompletionAt: new Date(Date.now() - 86_400_000).toISOString() });
      await intake({ expectedCompletionAt: new Date(Date.now() + 86_400_000).toISOString() });

      const response = await request(context.server).get('/api/v1/repairs?overdue=true&limit=100').set('Authorization', `Bearer ${staffToken}`).expect(200);
      const ids = body<RepairBody[]>(response).map((row) => row.id);

      expect(ids).toContain(late.id);
    });

    it('narrows to jobs nobody has picked up', async () => {
      const response = await request(context.server).get('/api/v1/repairs?unassigned=true&limit=100').set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<RepairBody[]>(response).every((row) => row.technicianId === null)).toBe(true);
    });

    it('filters by technician', async () => {
      await intake({ technicianId });

      const response = await request(context.server)
        .get(`/api/v1/repairs?technicianId=${technicianId}&limit=100`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(body<RepairBody[]>(response).every((row) => row.technicianId === technicianId)).toBe(true);
    });

    it('filters by device type', async () => {
      const response = await request(context.server)
        .get(`/api/v1/repairs?deviceType=${DeviceType.PHONE}&limit=100`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(body<RepairBody[]>(response).every((row) => row.deviceType === DeviceType.PHONE)).toBe(true);
    });

    it('refuses a sort column that is not on the whitelist', async () => {
      await request(context.server).get('/api/v1/repairs?sortBy=finalCost').set('Authorization', `Bearer ${staffToken}`).expect(400);
    });

    it('treats a search term containing SQL as text', async () => {
      const response = await request(context.server)
        .get(`/api/v1/repairs?search=${encodeURIComponent("' OR 1=1 --")}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(body<RepairBody[]>(response)).toHaveLength(0);
    });

    it('serves the status history on its own', async () => {
      const repair = await intake();
      await moveTo(repair.id, RepairStatus.DIAGNOSING);

      const response = await request(context.server).get(`/api/v1/repairs/${repair.id}/history`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<{ toStatus: RepairStatus }[]>(response).map((row) => row.toStatus)).toEqual([RepairStatus.RECEIVED, RepairStatus.DIAGNOSING]);
    });

    it('reports a missing repair as not found', async () => {
      await request(context.server).get('/api/v1/repairs/00000000-0000-4000-8000-00000000dead').set('Authorization', `Bearer ${staffToken}`).expect(404);
    });
  });

  describe('authorisation', () => {
    it('requires authentication', async () => {
      await request(context.server).get('/api/v1/repairs').expect(401);
    });

    it('lets a technician read and work but not take a device in', async () => {
      await request(context.server).get('/api/v1/repairs').set('Authorization', `Bearer ${technicianToken}`).expect(200);
      await request(context.server)
        .post('/api/v1/repairs')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ customerId, ...INTAKE })
        .expect(403);
    });

    it('keeps a salesperson away from the bench', async () => {
      const productId = await makePart('SALESGUARD', '30.00', 5);
      const repair = await onTheBench();

      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ diagnosis: 'Guessing' })
        .expect(403);

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/items`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ productId, quantity: 1 })
        .expect(403);
    });

    it('lets the counter move a repair along, since it hands devices back', async () => {
      const repair = await intake();

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/status`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ toStatus: RepairStatus.DIAGNOSING })
        .expect(200);
    });

    it('keeps a technician away from the till', async () => {
      const repair = await onTheBench();
      await request(context.server)
        .patch(`/api/v1/repairs/${repair.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ finalCost: '10.00' })
        .expect(200);
      await moveTo(repair.id, RepairStatus.COMPLETED);

      await request(context.server)
        .post(`/api/v1/repairs/${repair.id}/payments`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ method: PaymentMethod.CASH, amount: '10.00' })
        .expect(403);
    });
  });
});
