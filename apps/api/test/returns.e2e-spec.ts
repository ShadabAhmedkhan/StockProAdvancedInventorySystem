import request from 'supertest';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ReturnReason,
  ReturnStatus,
  StockMovementType,
  StockReferenceType,
  UserRole,
} from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

interface OrderBody {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: string;
  paidAmount: string;
  items: { id: string; productId: string; quantity: number; unitPrice: string; total: string }[];
}

interface ReturnBody {
  id: string;
  returnNumber: string;
  status: ReturnStatus;
  reason: ReturnReason;
  reasonNote: string | null;
  orderId: string;
  customerId: string | null;
  refundAmount: string;
  paidBackAmount: string;
  outstandingCredit: string;
  completedAt: string | null;
  items: { id: string; orderItemId: string; productId: string; quantity: number; unitPrice: string; total: string; restock: boolean }[];
  payments: { id: string; amount: string; method: PaymentMethod }[];
}

interface StockLevelBody {
  quantity: number;
  reservedQuantity: number;
}

function body<T>(response: { body: ApiResponse<T> }): T {
  return response.body.data;
}

function errorMessage(response: request.Response): string {
  return (response.body as ApiErrorResponse).message;
}

describe('Returns (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let categoryId: string;
  let customerId: string;

  function as(token: string, method: 'post' | 'patch' | 'delete' | 'get', path: string): request.Test {
    return request(context.server)[method](path).set('Authorization', `Bearer ${token}`);
  }

  async function makeProduct(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
    const created = await as(adminToken, 'post', '/api/v1/products')
      .send({ sku: `${label}-${suffix}`, name: `Returnable ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
      .expect(201);

    const productId = body<Identified>(created).id;

    await as(adminToken, 'post', '/api/v1/stock/adjust').send({ productId, type: StockMovementType.PURCHASE, quantity }).expect(200);

    return productId;
  }

  async function stockOf(productId: string): Promise<StockLevelBody> {
    const response = await as(adminToken, 'get', `/api/v1/stock/${productId}`).expect(200);

    return body<StockLevelBody>(response);
  }

  /**
   * A completed order, optionally paid. Returns need one before they can
   * exist, so almost every test starts here.
   */
  async function soldOrder(lines: { productId: string; quantity: number; unitPrice?: string; discount?: string }[], paid?: string): Promise<OrderBody> {
    const created = await as(staffToken, 'post', '/api/v1/orders').send({ customerId, items: lines }).expect(201);
    const order = body<OrderBody>(created);

    await as(staffToken, 'post', `/api/v1/orders/${order.id}/confirm`).expect(200);

    if (paid !== undefined) {
      await as(staffToken, 'post', `/api/v1/orders/${order.id}/payments`).send({ method: PaymentMethod.CASH, amount: paid }).expect(201);
    }

    const completed = await as(staffToken, 'post', `/api/v1/orders/${order.id}/complete`).expect(200);

    return body<OrderBody>(completed);
  }

  async function raiseReturn(order: OrderBody, quantity: number, extra: Record<string, unknown> = {}): Promise<ReturnBody> {
    const created = await as(staffToken, 'post', '/api/v1/returns')
      .send({
        orderId: order.id,
        reason: ReturnReason.DEFECTIVE,
        items: [{ orderItemId: order.items[0]?.id ?? '', quantity, ...extra }],
      })
      .expect(201);

    return body<ReturnBody>(created);
  }

  async function completeReturn(id: string): Promise<ReturnBody> {
    await as(adminToken, 'post', `/api/v1/returns/${id}/approve`).expect(200);
    const done = await as(adminToken, 'post', `/api/v1/returns/${id}/complete`).send({ method: PaymentMethod.CASH }).expect(200);

    return body<ReturnBody>(done);
  }

  beforeAll(async () => {
    // Each test builds an order before it can return anything, so this suite
    // puts through more than the production per-address allowance in a minute.
    context = await createTestApp({ throttleLimit: 5000 });
    label = `RT${context.run.slice(0, 5).toUpperCase()}`;

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

    adminToken = (await signInAs(context, 'ret-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'ret-staff', UserRole.STAFF)).accessToken;

    const category = await as(adminToken, 'post', '/api/v1/categories')
      .send({ name: `${label} Returnables` })
      .expect(201);
    categoryId = body<Identified>(category).id;

    const customer = await as(adminToken, 'post', '/api/v1/customers')
      .send({ customerCode: `${label}-C1`, firstName: 'Return', lastName: 'Customer', phone: '+1 555 0133' })
      .expect(201);
    customerId = body<Identified>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('raising a return', () => {
    it('opens a pending return with a document number', async () => {
      const order = await soldOrder([{ productId: await makeProduct('OPEN', '10.00', 20), quantity: 2 }], '20.00');
      const record = await raiseReturn(order, 1);

      expect(record.status).toBe(ReturnStatus.PENDING);
      expect(record.returnNumber).toMatch(/^RET-\d{8}$/);
      expect(record.completedAt).toBeNull();
    });

    it('takes the customer from the order', async () => {
      const order = await soldOrder([{ productId: await makeProduct('CUST', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);

      expect(record.customerId).toBe(customerId);
    });

    it('prices the line from what was charged, not the list price', async () => {
      // Three units listed at 20.00 with 10.00 off the line: charged 50.00.
      const productId = await makeProduct('DISCOUNTED', '20.00', 20);
      const order = await soldOrder([{ productId, quantity: 3, discount: '10.00' }], '50.00');
      const record = await raiseReturn(order, 1);

      expect(order.items[0]?.total).toBe('50.00');
      expect(record.items[0]?.total).toBe('16.67');
      expect(record.refundAmount).toBe('16.67');
    });

    it('refuses goods from an order that never went out', async () => {
      const productId = await makeProduct('UNSOLD', '10.00', 20);
      const created = await as(staffToken, 'post', '/api/v1/orders')
        .send({ customerId, items: [{ productId, quantity: 1 }] })
        .expect(201);
      const draft = body<OrderBody>(created);

      const response = await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: draft.id, reason: ReturnReason.CHANGED_MIND, items: [{ orderItemId: draft.items[0]?.id ?? '', quantity: 1 }] })
        .expect(422);

      expect(errorMessage(response)).toMatch(/goods can only come back from an order that has been completed/);
    });

    it('refuses more units than were sold', async () => {
      const order = await soldOrder([{ productId: await makeProduct('TOOMANY', '10.00', 20), quantity: 2 }], '20.00');

      const response = await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: order.id, reason: ReturnReason.DAMAGED, items: [{ orderItemId: order.items[0]?.id ?? '', quantity: 3 }] })
        .expect(422);

      expect(errorMessage(response)).toMatch(/Only 2 of 2 .* are still open to return; 3 were asked for/);
    });

    it('refuses a line from a different order', async () => {
      const mine = await soldOrder([{ productId: await makeProduct('MINE', '10.00', 20), quantity: 1 }], '10.00');
      const theirs = await soldOrder([{ productId: await makeProduct('THEIRS', '10.00', 20), quantity: 1 }], '10.00');

      await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: mine.id, reason: ReturnReason.WRONG_ITEM, items: [{ orderItemId: theirs.items[0]?.id ?? '', quantity: 1 }] })
        .expect(404);
    });

    it('refuses a return with no lines', async () => {
      const order = await soldOrder([{ productId: await makeProduct('EMPTY', '10.00', 20), quantity: 1 }], '10.00');

      await as(staffToken, 'post', '/api/v1/returns').send({ orderId: order.id, reason: ReturnReason.OTHER, items: [] }).expect(400);
    });

    it('leaves nothing behind when a line is bad', async () => {
      const order = await soldOrder([{ productId: await makeProduct('ROLLBACK', '10.00', 20), quantity: 1 }], '10.00');

      await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: order.id, reason: ReturnReason.OTHER, items: [{ orderItemId: order.items[0]?.id ?? '', quantity: 99 }] })
        .expect(422);

      // Scoped to this order rather than a whole-table count: other e2e
      // suites create returns concurrently against the same database.
      expect(await context.prisma.return.count({ where: { orderId: order.id } })).toBe(0);
    });

    it('rejects a reason it has never heard of', async () => {
      const order = await soldOrder([{ productId: await makeProduct('BADREASON', '10.00', 20), quantity: 1 }], '10.00');

      await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: order.id, reason: 'BECAUSE', items: [{ orderItemId: order.items[0]?.id ?? '', quantity: 1 }] })
        .expect(400);
    });
  });

  describe('what a line has left', () => {
    it('counts an earlier pending return against the remainder', async () => {
      const order = await soldOrder([{ productId: await makeProduct('PENDINGCLAIM', '10.00', 20), quantity: 3 }], '30.00');
      await raiseReturn(order, 2);

      const response = await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: order.id, reason: ReturnReason.DAMAGED, items: [{ orderItemId: order.items[0]?.id ?? '', quantity: 2 }] })
        .expect(422);

      expect(errorMessage(response)).toMatch(/Only 1 of 3/);
    });

    it('frees the units again when a return is rejected', async () => {
      const order = await soldOrder([{ productId: await makeProduct('REJECTFREE', '10.00', 20), quantity: 3 }], '30.00');
      const first = await raiseReturn(order, 3);

      await as(adminToken, 'post', `/api/v1/returns/${first.id}/reject`).expect(200);

      // The shop declined it, so all three units are open to return again.
      const second = await raiseReturn(order, 3);
      expect(second.refundAmount).toBe('30.00');
    });

    it('adds up to the line total however the line comes back', async () => {
      const productId = await makeProduct('INSTALMENTS', '20.00', 20);
      const order = await soldOrder([{ productId, quantity: 3, discount: '10.00' }], '50.00');
      const refunds: string[] = [];

      for (let unit = 0; unit < 3; unit += 1) {
        const record = await raiseReturn(order, 1);
        refunds.push((await completeReturn(record.id)).refundAmount);
      }

      // 16.67 + 16.67 + 16.66 = 50.00, not 50.01.
      expect(refunds).toEqual(['16.67', '16.67', '16.66']);
      const total = refunds.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0);
      expect(total).toBe(5000);
    });

    it('refuses a line that has already come back in full', async () => {
      const order = await soldOrder([{ productId: await makeProduct('EXHAUSTED', '10.00', 20), quantity: 2 }], '20.00');
      const record = await raiseReturn(order, 2);
      await completeReturn(record.id);

      await as(staffToken, 'post', '/api/v1/returns')
        .send({ orderId: order.id, reason: ReturnReason.DAMAGED, items: [{ orderItemId: order.items[0]?.id ?? '', quantity: 1 }] })
        .expect(422);
    });
  });

  describe('editing a pending return', () => {
    it('re-prices when a quantity changes', async () => {
      const order = await soldOrder([{ productId: await makeProduct('REPRICE', '10.00', 20), quantity: 4 }], '40.00');
      const record = await raiseReturn(order, 1);

      const updated = await as(staffToken, 'patch', `/api/v1/returns/${record.id}/items/${record.items[0]?.id ?? ''}`)
        .send({ quantity: 3 })
        .expect(200);

      expect(body<ReturnBody>(updated).refundAmount).toBe('30.00');
    });

    it('measures a quantity change against other returns, not itself', async () => {
      const order = await soldOrder([{ productId: await makeProduct('SELFCOUNT', '10.00', 20), quantity: 3 }], '30.00');
      const record = await raiseReturn(order, 2);

      // Three were sold and this return already claims two; asking for three
      // must succeed, because its own two do not count against it.
      await as(staffToken, 'patch', `/api/v1/returns/${record.id}/items/${record.items[0]?.id ?? ''}`)
        .send({ quantity: 3 })
        .expect(200);
    });

    it('adds a second line for another product on the same order', async () => {
      const first = await makeProduct('TWOLINE1', '10.00', 20);
      const second = await makeProduct('TWOLINE2', '5.00', 20);
      const order = await soldOrder(
        [
          { productId: first, quantity: 2 },
          { productId: second, quantity: 4 },
        ],
        '40.00',
      );
      const record = await raiseReturn(order, 1);

      const updated = await as(staffToken, 'post', `/api/v1/returns/${record.id}/items`)
        .send({ orderItemId: order.items[1]?.id ?? '', quantity: 2 })
        .expect(200);

      expect(body<ReturnBody>(updated).items).toHaveLength(2);
      expect(body<ReturnBody>(updated).refundAmount).toBe('20.00');
    });

    it('refuses the same order line twice on one return', async () => {
      const order = await soldOrder([{ productId: await makeProduct('DUPLINE', '10.00', 20), quantity: 3 }], '30.00');
      const record = await raiseReturn(order, 1);

      await as(staffToken, 'post', `/api/v1/returns/${record.id}/items`)
        .send({ orderItemId: order.items[0]?.id ?? '', quantity: 1 })
        .expect(409);
    });

    it('refuses to empty a return of its last line', async () => {
      const order = await soldOrder([{ productId: await makeProduct('LASTLINE', '10.00', 20), quantity: 2 }], '20.00');
      const record = await raiseReturn(order, 1);

      const response = await as(staffToken, 'delete', `/api/v1/returns/${record.id}/items/${record.items[0]?.id ?? ''}`).expect(422);

      expect(errorMessage(response)).toMatch(/reject the return instead of emptying it/);
    });

    it('updates the reason while it is pending', async () => {
      const order = await soldOrder([{ productId: await makeProduct('REASON', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);

      const updated = await as(staffToken, 'patch', `/api/v1/returns/${record.id}`)
        .send({ reason: ReturnReason.CHANGED_MIND, reasonNote: 'Bought the wrong colour' })
        .expect(200);

      expect(body<ReturnBody>(updated).reason).toBe(ReturnReason.CHANGED_MIND);
      expect(body<ReturnBody>(updated).reasonNote).toBe('Bought the wrong colour');
    });

    it('freezes the lines once approved', async () => {
      const order = await soldOrder([{ productId: await makeProduct('FROZEN', '10.00', 20), quantity: 3 }], '30.00');
      const record = await raiseReturn(order, 1);
      await as(adminToken, 'post', `/api/v1/returns/${record.id}/approve`).expect(200);

      const response = await as(staffToken, 'patch', `/api/v1/returns/${record.id}/items/${record.items[0]?.id ?? ''}`)
        .send({ quantity: 2 })
        .expect(409);

      expect(errorMessage(response)).toMatch(/is APPROVED; that action needs it to be PENDING/);
    });
  });

  describe('approval', () => {
    it('moves nothing when a return is approved', async () => {
      const productId = await makeProduct('APPROVEONLY', '10.00', 20);
      const order = await soldOrder([{ productId, quantity: 2 }], '20.00');
      const before = await stockOf(productId);
      const record = await raiseReturn(order, 2);

      await as(adminToken, 'post', `/api/v1/returns/${record.id}/approve`).expect(200);

      expect((await stockOf(productId)).quantity).toBe(before.quantity);
      expect(await context.prisma.payment.count({ where: { returnId: record.id } })).toBe(0);
    });

    it('refuses to refund a return nobody approved', async () => {
      const order = await soldOrder([{ productId: await makeProduct('UNAPPROVED', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);

      await as(adminToken, 'post', `/api/v1/returns/${record.id}/complete`).send({ method: PaymentMethod.CASH }).expect(409);
    });

    it('refuses to decline a return the shop already agreed to', async () => {
      const order = await soldOrder([{ productId: await makeProduct('NOUNDO', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);
      await as(adminToken, 'post', `/api/v1/returns/${record.id}/approve`).expect(200);

      await as(adminToken, 'post', `/api/v1/returns/${record.id}/reject`).expect(409);
    });

    it('treats a rejected return as final', async () => {
      const order = await soldOrder([{ productId: await makeProduct('FINALREJECT', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);
      await as(adminToken, 'post', `/api/v1/returns/${record.id}/reject`).expect(200);

      const response = await as(adminToken, 'post', `/api/v1/returns/${record.id}/approve`).expect(409);
      expect(errorMessage(response)).toMatch(/is REJECTED, which is final/);
    });
  });

  describe('completing', () => {
    it('puts sellable goods back and says why', async () => {
      const productId = await makeProduct('RESTOCK', '10.00', 20);
      const order = await soldOrder([{ productId, quantity: 5 }], '50.00');
      const afterSale = await stockOf(productId);
      const record = await raiseReturn(order, 3);

      const done = await completeReturn(record.id);

      const movements = await context.prisma.stockMovement.findMany({ where: { productId, type: StockMovementType.RETURN_IN } });
      expect(afterSale.quantity).toBe(15);
      expect((await stockOf(productId)).quantity).toBe(18);
      expect(done.completedAt).not.toBeNull();
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        quantity: 3,
        previousQuantity: 15,
        newQuantity: 18,
        referenceType: StockReferenceType.RETURN,
        referenceId: record.id,
      });
    });

    it('credits but does not restock goods that came back broken', async () => {
      const productId = await makeProduct('BROKEN', '10.00', 20);
      const order = await soldOrder([{ productId, quantity: 4 }], '40.00');
      const record = await raiseReturn(order, 2, { restock: false });

      const done = await completeReturn(record.id);

      expect((await stockOf(productId)).quantity).toBe(16);
      expect(await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.RETURN_IN } })).toBe(0);
      expect(done.refundAmount).toBe('20.00');
      expect(done.paidBackAmount).toBe('20.00');
    });

    it('records the refund against the return', async () => {
      const order = await soldOrder([{ productId: await makeProduct('REFUND', '10.00', 20), quantity: 2 }], '20.00');
      const record = await raiseReturn(order, 2);

      const done = await completeReturn(record.id);

      expect(done.payments).toHaveLength(1);
      expect(done.payments[0]?.amount).toBe('20.00');
      expect(done.outstandingCredit).toBe('0.00');
    });

    it('caps the money at what the customer actually paid', async () => {
      // Sold 50.00 worth but only 20.00 was ever collected.
      const order = await soldOrder([{ productId: await makeProduct('PARTPAID', '10.00', 20), quantity: 5 }], '20.00');
      const record = await raiseReturn(order, 5);

      const done = await completeReturn(record.id);

      expect(done.refundAmount).toBe('50.00');
      expect(done.paidBackAmount).toBe('20.00');
      expect(done.outstandingCredit).toBe('30.00');
    });

    it('hands nothing back on an order nobody paid for', async () => {
      const productId = await makeProduct('UNPAID', '10.00', 20);
      const order = await soldOrder([{ productId, quantity: 3 }]);
      const record = await raiseReturn(order, 3);

      const done = await completeReturn(record.id);

      // The goods still come back; there is simply no money to return.
      expect((await stockOf(productId)).quantity).toBe(20);
      expect(done.paidBackAmount).toBe('0.00');
      expect(done.payments).toHaveLength(0);
    });

    it('marks the order refunded once everything collected has gone back', async () => {
      const order = await soldOrder([{ productId: await makeProduct('FULLREFUND', '10.00', 20), quantity: 2 }], '20.00');
      const record = await raiseReturn(order, 2);
      await completeReturn(record.id);

      const after = await as(staffToken, 'get', `/api/v1/orders/${order.id}`).expect(200);
      expect(body<OrderBody>(after).paymentStatus).toBe(PaymentStatus.REFUNDED);
    });

    it('leaves a part-refunded order alone', async () => {
      const order = await soldOrder([{ productId: await makeProduct('PARTREFUND', '10.00', 20), quantity: 4 }], '40.00');
      const record = await raiseReturn(order, 1);
      await completeReturn(record.id);

      const after = await as(staffToken, 'get', `/api/v1/orders/${order.id}`).expect(200);
      expect(body<OrderBody>(after).paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('counts refunds already made against the same order', async () => {
      const order = await soldOrder([{ productId: await makeProduct('SECONDREFUND', '10.00', 20), quantity: 4 }], '20.00');

      const first = await raiseReturn(order, 2);
      expect((await completeReturn(first.id)).paidBackAmount).toBe('20.00');

      // Everything collected has already gone back, so the second gets nothing.
      const second = await raiseReturn(order, 2);
      const done = await completeReturn(second.id);

      expect(done.refundAmount).toBe('20.00');
      expect(done.paidBackAmount).toBe('0.00');
    });

    it('treats a completed return as final', async () => {
      const order = await soldOrder([{ productId: await makeProduct('FINALDONE', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);
      await completeReturn(record.id);

      const response = await as(adminToken, 'post', `/api/v1/returns/${record.id}/complete`).send({ method: PaymentMethod.CASH }).expect(409);
      expect(errorMessage(response)).toMatch(/is COMPLETED, which is final/);
    });

    it('lists the refunds paid against a return', async () => {
      const order = await soldOrder([{ productId: await makeProduct('REFUNDLIST', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);
      await completeReturn(record.id);

      const response = await as(staffToken, 'get', `/api/v1/returns/${record.id}/payments`).expect(200);
      expect(body<{ amount: string }[]>(response).map((payment) => payment.amount)).toEqual(['10.00']);
    });
  });

  describe('listing', () => {
    it('paginates', async () => {
      const response = await as(staffToken, 'get', '/api/v1/returns?page=1&limit=2').expect(200);

      expect(body<ReturnBody[]>(response).length).toBeLessThanOrEqual(2);
      expect((response.body as ApiResponse<ReturnBody[]>).meta.limit).toBe(2);
    });

    it('finds a return by its number', async () => {
      const order = await soldOrder([{ productId: await makeProduct('FINDME', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);

      const response = await as(staffToken, 'get', `/api/v1/returns?search=${record.returnNumber}`).expect(200);

      expect(body<ReturnBody[]>(response).map((row) => row.id)).toEqual([record.id]);
    });

    it('filters by status', async () => {
      const response = await as(staffToken, 'get', `/api/v1/returns?status=${ReturnStatus.REJECTED}&limit=100`).expect(200);

      expect(body<ReturnBody[]>(response).every((row) => row.status === ReturnStatus.REJECTED)).toBe(true);
    });

    it('filters by order', async () => {
      const order = await soldOrder([{ productId: await makeProduct('BYORDER', '10.00', 20), quantity: 2 }], '20.00');
      await raiseReturn(order, 1);

      const response = await as(staffToken, 'get', `/api/v1/returns?orderId=${order.id}&limit=100`).expect(200);

      expect(body<ReturnBody[]>(response).every((row) => row.orderId === order.id)).toBe(true);
      expect(body<ReturnBody[]>(response).length).toBe(1);
    });

    it('refuses a sort column that is not on the whitelist', async () => {
      await as(staffToken, 'get', '/api/v1/returns?sortBy=reasonNote').expect(400);
    });

    it('treats a search term containing SQL as text', async () => {
      const response = await as(staffToken, 'get', `/api/v1/returns?search=${encodeURIComponent("' OR 1=1 --")}`).expect(200);

      expect(body<ReturnBody[]>(response)).toHaveLength(0);
    });

    it('reports a missing return as not found', async () => {
      await as(staffToken, 'get', '/api/v1/returns/00000000-0000-4000-8000-00000000dead').expect(404);
    });
  });

  describe('authorisation', () => {
    it('requires authentication', async () => {
      await request(context.server).get('/api/v1/returns').expect(401);
    });

    it('lets staff raise a return but not decide on it', async () => {
      const order = await soldOrder([{ productId: await makeProduct('STAFFGUARD', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);

      await as(staffToken, 'post', `/api/v1/returns/${record.id}/approve`).expect(403);
      await as(staffToken, 'post', `/api/v1/returns/${record.id}/reject`).expect(403);
    });

    it('keeps staff away from handing money back', async () => {
      const order = await soldOrder([{ productId: await makeProduct('MONEYGUARD', '10.00', 20), quantity: 1 }], '10.00');
      const record = await raiseReturn(order, 1);
      await as(adminToken, 'post', `/api/v1/returns/${record.id}/approve`).expect(200);

      await as(staffToken, 'post', `/api/v1/returns/${record.id}/complete`).send({ method: PaymentMethod.CASH }).expect(403);
    });
  });
});
