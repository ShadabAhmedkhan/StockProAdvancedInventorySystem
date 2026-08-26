import request from 'supertest';
import type { ApiErrorResponse, ApiResponse } from '../src/common/interfaces/api-response.interface';
import { OrderStatus, PaymentMethod, PaymentStatus, StockMovementType, StockReferenceType, UserRole } from '../src/generated/prisma/enums';
import { closeTestApp, createTestApp, inviteTeammate, signInAs, type TestApp } from './support/auth.helper';

interface Identified {
  id: string;
}

interface OrderBody {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  paidAmount: string;
  outstanding: string;
  completedAt: string | null;
  customerId: string | null;
  items: { id: string; productId: string; quantity: number; unitPrice: string; discount: string; total: string }[];
  payments: { id: string; amount: string; method: PaymentMethod }[];
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

describe('Orders (e2e)', () => {
  let context: TestApp;
  let label: string;
  let adminToken: string;
  let staffToken: string;
  let technicianToken: string;
  let categoryId: string;
  let customerId: string;

  /** A product with a known price and a known amount of stock behind it. */
  async function makeProduct(suffix: string, sellingPrice: string, quantity: number): Promise<string> {
    const created = await request(context.server)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sku: `${label}-${suffix}`, name: `Order ${suffix}`, categoryId, costPrice: '1.00', sellingPrice })
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

  async function draftWith(productId: string, quantity: number, extra: Record<string, unknown> = {}): Promise<OrderBody> {
    const response = await request(context.server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ items: [{ productId, quantity }], ...extra })
      .expect(201);

    return body<OrderBody>(response);
  }

  async function confirmedWith(productId: string, quantity: number, extra: Record<string, unknown> = {}): Promise<OrderBody> {
    const draft = await draftWith(productId, quantity, extra);
    const response = await request(context.server).post(`/api/v1/orders/${draft.id}/confirm`).set('Authorization', `Bearer ${staffToken}`).expect(200);

    return body<OrderBody>(response);
  }

  beforeAll(async () => {
    context = await createTestApp();
    label = `OR${context.run.slice(0, 5).toUpperCase()}`;

    // Everything these users touched, in dependency order. Orders are keyed on
    // their author rather than on the label, because most of them are walk-in
    // sales with nothing else to recognise them by; order items go with the
    // order they cascade from.
    context.cleanup.push(async () => {
      const createdById = { in: context.createdUserIds };

      await context.prisma.auditLog.deleteMany({ where: { userId: createdById } });

      await context.prisma.financialTransaction.deleteMany({ where: { createdById } });
      await context.prisma.payment.deleteMany({ where: { createdById } });
      await context.prisma.order.deleteMany({ where: { createdById } });
      await context.prisma.stockMovement.deleteMany({ where: { createdById } });
      // Inventory cascades from Product, so deleting it separately only risks
      // stranding products without a stock row if a later delete fails.
      await context.prisma.product.deleteMany({ where: { sku: { startsWith: label } } });
      await context.prisma.customer.deleteMany({ where: { customerCode: { startsWith: label } } });
      await context.prisma.category.deleteMany({ where: { name: { startsWith: label } } });
    });

    adminToken = (await signInAs(context, 'orders-admin', UserRole.ADMIN)).accessToken;
    staffToken = (await inviteTeammate(context, adminToken, 'orders-staff', UserRole.STAFF)).accessToken;
    technicianToken = (await inviteTeammate(context, adminToken, 'orders-tech', UserRole.TECHNICIAN)).accessToken;

    const category = await request(context.server)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${label} Order Category` })
      .expect(201);
    categoryId = body<Identified>(category).id;

    const customer = await request(context.server)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ customerCode: `${label}-C1`, firstName: 'Order', lastName: 'Customer', phone: '+1 555 0100' })
      .expect(201);
    customerId = body<Identified>(customer).id;
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  describe('creating a draft', () => {
    it('opens an empty draft with a document number', async () => {
      const response = await request(context.server).post('/api/v1/orders').set('Authorization', `Bearer ${staffToken}`).send({}).expect(201);
      const order = body<OrderBody>(response);

      expect(order.status).toBe(OrderStatus.DRAFT);
      expect(order.orderNumber).toMatch(/^ORD-\d{8}$/);
      expect(order.total).toBe('0.00');
      expect(order.paymentStatus).toBe(PaymentStatus.UNPAID);
    });

    it('gives every order a different number', async () => {
      const first = await request(context.server).post('/api/v1/orders').set('Authorization', `Bearer ${staffToken}`).send({}).expect(201);
      const second = await request(context.server).post('/api/v1/orders').set('Authorization', `Bearer ${staffToken}`).send({}).expect(201);

      expect(body<OrderBody>(first).orderNumber).not.toBe(body<OrderBody>(second).orderNumber);
    });

    it('prices opening lines from the catalogue', async () => {
      const productId = await makeProduct('PRICE', '19.99', 10);
      const order = await draftWith(productId, 3);

      expect(order.items[0]?.unitPrice).toBe('19.99');
      expect(order.items[0]?.total).toBe('59.97');
      expect(order.subtotal).toBe('59.97');
      expect(order.total).toBe('59.97');
    });

    it('is exact where floating point is not', async () => {
      const productId = await makeProduct('PENNY', '0.07', 10);
      const order = await draftWith(productId, 3);

      // 0.07 * 3 is 0.21000000000000002 as a binary float.
      expect(order.total).toBe('0.21');
    });

    it('accepts a walk-in sale with no customer', async () => {
      const order = await draftWith(await makeProduct('WALKIN', '5.00', 5), 1);

      expect(order.customerId).toBeNull();
    });

    it('attaches a customer when one is given', async () => {
      const order = await draftWith(await makeProduct('NAMED', '5.00', 5), 1, { customerId });

      expect(order.customerId).toBe(customerId);
    });

    it('rejects a customer who does not exist', async () => {
      await request(context.server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ customerId: '00000000-0000-4000-8000-00000000dead' })
        .expect(404);
    });

    it('rejects a product that does not exist', async () => {
      await request(context.server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ items: [{ productId: '00000000-0000-4000-8000-00000000dead', quantity: 1 }] })
        .expect(404);
    });

    it('leaves no half-built order behind when a line is bad', async () => {
      const before = await context.prisma.order.count();

      await request(context.server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ notes: `${label} rollback`, items: [{ productId: '00000000-0000-4000-8000-00000000dead', quantity: 1 }] })
        .expect(404);

      expect(await context.prisma.order.count()).toBe(before);
    });

    it.each([
      ['a zero quantity', { quantity: 0 }],
      ['a negative quantity', { quantity: -1 }],
      ['a fractional quantity', { quantity: 1.5 }],
      ['a negative price', { unitPrice: '-1.00' }],
      ['a price with three decimals', { unitPrice: '1.001' }],
    ])('rejects %s', async (_name, override) => {
      const productId = await makeProduct(`BAD${String(Object.values(override)[0]).replace(/\W/g, '')}`, '5.00', 5);

      await request(context.server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ items: [{ productId, quantity: 1, ...override }] })
        .expect(400);
    });
  });

  describe('editing a draft', () => {
    it('adds a line and re-prices the order', async () => {
      const first = await makeProduct('ADD1', '10.00', 5);
      const second = await makeProduct('ADD2', '2.50', 5);
      const order = await draftWith(first, 2);

      const updated = await request(context.server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ productId: second, quantity: 4 })
        .expect(200);

      expect(body<OrderBody>(updated).total).toBe('30.00');
    });

    it('refuses the same product twice', async () => {
      const productId = await makeProduct('DUP', '10.00', 5);
      const order = await draftWith(productId, 1);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ productId, quantity: 1 })
        .expect(409);
    });

    it('changes a quantity and re-prices', async () => {
      const productId = await makeProduct('QTY', '10.00', 20);
      const order = await draftWith(productId, 2);

      const updated = await request(context.server)
        .patch(`/api/v1/orders/${order.id}/items/${order.items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ quantity: 7 })
        .expect(200);

      expect(body<OrderBody>(updated).total).toBe('70.00');
    });

    it('removes a line and re-prices', async () => {
      const productId = await makeProduct('DEL', '10.00', 5);
      const order = await draftWith(productId, 2);

      const updated = await request(context.server)
        .delete(`/api/v1/orders/${order.id}/items/${order.items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(body<OrderBody>(updated).items).toHaveLength(0);
      expect(body<OrderBody>(updated).total).toBe('0.00');
    });

    it('applies an order discount and tax on top of the lines', async () => {
      const productId = await makeProduct('TAX', '100.00', 5);
      const order = await draftWith(productId, 1);

      const updated = await request(context.server)
        .patch(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ discount: '10.00', tax: '4.50' })
        .expect(200);

      expect(body<OrderBody>(updated).subtotal).toBe('100.00');
      expect(body<OrderBody>(updated).total).toBe('94.50');
    });

    it('refuses a line discount larger than the line', async () => {
      const productId = await makeProduct('LDISC', '10.00', 5);
      const order = await draftWith(productId, 2);

      await request(context.server)
        .patch(`/api/v1/orders/${order.id}/items/${order.items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ discount: '21.00' })
        .expect(422);
    });

    it('refuses an order discount larger than the order', async () => {
      const productId = await makeProduct('ODISC', '10.00', 5);
      const order = await draftWith(productId, 1);

      await request(context.server).patch(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${staffToken}`).send({ discount: '11.00' }).expect(422);
    });

    it('refuses to strand an order discount by removing the lines under it', async () => {
      const productId = await makeProduct('STRAND', '10.00', 5);
      const order = await draftWith(productId, 2, { discount: '15.00' });

      const response = await request(context.server)
        .delete(`/api/v1/orders/${order.id}/items/${order.items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(422);

      expect(errorMessage(response)).toMatch(/reduce the discount first/);
    });

    it('refuses to touch an item from a different order', async () => {
      const mine = await draftWith(await makeProduct('MINE', '10.00', 5), 1);
      const theirs = await draftWith(await makeProduct('THEIRS', '10.00', 5), 1);

      await request(context.server)
        .delete(`/api/v1/orders/${mine.id}/items/${theirs.items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(404);
    });

    it('reserves nothing while the order is still a draft', async () => {
      const productId = await makeProduct('NORES', '10.00', 8);
      await draftWith(productId, 5);

      const stock = await stockOf(productId);
      expect(stock.reservedQuantity).toBe(0);
      expect(stock.availableQuantity).toBe(8);
    });
  });

  describe('confirming', () => {
    it('reserves the stock without taking it off the shelf', async () => {
      const productId = await makeProduct('RESERVE', '10.00', 8);
      const order = await confirmedWith(productId, 5);

      const stock = await stockOf(productId);
      expect(order.status).toBe(OrderStatus.CONFIRMED);
      expect(stock.quantity).toBe(8);
      expect(stock.reservedQuantity).toBe(5);
      expect(stock.availableQuantity).toBe(3);
    });

    it('refuses when there is not enough stock, and reserves nothing', async () => {
      const productId = await makeProduct('SHORT', '10.00', 2);
      const order = await draftWith(productId, 5);

      const response = await request(context.server).post(`/api/v1/orders/${order.id}/confirm`).set('Authorization', `Bearer ${staffToken}`).expect(409);

      expect(errorMessage(response)).toMatch(/2 available/);
      expect((await stockOf(productId)).reservedQuantity).toBe(0);
    });

    it('leaves the order a draft when the reservation fails', async () => {
      const productId = await makeProduct('STAYDRAFT', '10.00', 1);
      const order = await draftWith(productId, 4);

      await request(context.server).post(`/api/v1/orders/${order.id}/confirm`).set('Authorization', `Bearer ${staffToken}`).expect(409);

      const after = await request(context.server).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      expect(body<OrderBody>(after).status).toBe(OrderStatus.DRAFT);
    });

    it('reserves nothing for any line when one line is short', async () => {
      const plenty = await makeProduct('PLENTY', '10.00', 50);
      const scarce = await makeProduct('SCARCE', '10.00', 1);
      const order = await draftWith(plenty, 2);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/items`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ productId: scarce, quantity: 9 })
        .expect(200);

      await request(context.server).post(`/api/v1/orders/${order.id}/confirm`).set('Authorization', `Bearer ${staffToken}`).expect(409);

      // The whole confirmation rolls back, including the line that would have fitted.
      expect((await stockOf(plenty)).reservedQuantity).toBe(0);
    });

    it('refuses an order with no lines', async () => {
      const empty = await request(context.server).post('/api/v1/orders').set('Authorization', `Bearer ${staffToken}`).send({}).expect(201);

      await request(context.server)
        .post(`/api/v1/orders/${body<OrderBody>(empty).id}/confirm`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(422);
    });

    it('refuses to confirm twice', async () => {
      const order = await confirmedWith(await makeProduct('TWICE', '10.00', 10), 1);

      await request(context.server).post(`/api/v1/orders/${order.id}/confirm`).set('Authorization', `Bearer ${staffToken}`).expect(409);
    });

    it('freezes the lines once confirmed', async () => {
      const order = await confirmedWith(await makeProduct('FROZEN', '10.00', 10), 1);

      await request(context.server)
        .patch(`/api/v1/orders/${order.id}/items/${order.items[0]?.id ?? ''}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ quantity: 2 })
        .expect(409);
    });

    it('writes no stock movement, because nothing has moved yet', async () => {
      const productId = await makeProduct('NOMOVE', '10.00', 10);
      await confirmedWith(productId, 3);

      expect(await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.SALE } })).toBe(0);
    });
  });

  describe('completing', () => {
    it('takes the stock off the shelf and clears the reservation', async () => {
      const productId = await makeProduct('SHIP', '10.00', 8);
      const order = await confirmedWith(productId, 5);

      const completed = await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      const stock = await stockOf(productId);
      expect(body<OrderBody>(completed).status).toBe(OrderStatus.COMPLETED);
      expect(stock.quantity).toBe(3);
      expect(stock.reservedQuantity).toBe(0);
    });

    it('stamps the completion time revenue is reported on', async () => {
      const order = await confirmedWith(await makeProduct('STAMP', '10.00', 5), 1);

      const completed = await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<OrderBody>(completed).completedAt).not.toBeNull();
    });

    it('writes one SALE movement per line, pointing back at the order', async () => {
      const productId = await makeProduct('LEDGER', '10.00', 10);
      const order = await confirmedWith(productId, 4);

      await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      const movements = await context.prisma.stockMovement.findMany({ where: { productId, type: StockMovementType.SALE } });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        quantity: 4,
        previousQuantity: 10,
        newQuantity: 6,
        referenceType: StockReferenceType.ORDER,
        referenceId: order.id,
      });
    });

    it('refuses to complete a draft that was never confirmed', async () => {
      const order = await draftWith(await makeProduct('NEVER', '10.00', 5), 1);

      await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(409);
    });

    it('refuses to complete twice', async () => {
      const order = await confirmedWith(await makeProduct('DONE', '10.00', 5), 1);
      await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(409);
    });

    it('refuses to cancel a completed order, which is what returns are for', async () => {
      const order = await confirmedWith(await makeProduct('FINAL', '10.00', 5), 1);
      await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      await request(context.server).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${staffToken}`).expect(409);
    });
  });

  describe('cancelling', () => {
    it('gives a confirmed order its reservation back', async () => {
      const productId = await makeProduct('RELEASE', '10.00', 8);
      const order = await confirmedWith(productId, 5);

      const cancelled = await request(context.server).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      const stock = await stockOf(productId);
      expect(body<OrderBody>(cancelled).status).toBe(OrderStatus.CANCELLED);
      expect(stock.quantity).toBe(8);
      expect(stock.reservedQuantity).toBe(0);
      expect(stock.availableQuantity).toBe(8);
    });

    it('cancels a draft, which never held a reservation', async () => {
      const productId = await makeProduct('DRAFTCAN', '10.00', 5);
      const order = await draftWith(productId, 2);

      await request(context.server).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect((await stockOf(productId)).reservedQuantity).toBe(0);
    });

    it('writes no stock movement, because nothing ever left', async () => {
      const productId = await makeProduct('CANMOVE', '10.00', 5);
      const order = await confirmedWith(productId, 2);

      await request(context.server).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(await context.prisma.stockMovement.count({ where: { productId, type: StockMovementType.SALE } })).toBe(0);
    });

    it('refuses to cancel an order that has money against it', async () => {
      const order = await confirmedWith(await makeProduct('PAIDCAN', '10.00', 5), 1);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '10.00' })
        .expect(201);

      const response = await request(context.server).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${staffToken}`).expect(409);
      expect(errorMessage(response)).toMatch(/refund the payment before cancelling/);
    });

    it('keeps the reservation when the cancellation is refused', async () => {
      const productId = await makeProduct('KEEPRES', '10.00', 6);
      const order = await confirmedWith(productId, 2);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '5.00' })
        .expect(201);

      await request(context.server).post(`/api/v1/orders/${order.id}/cancel`).set('Authorization', `Bearer ${staffToken}`).expect(409);

      // The refusal rolled the whole transaction back, reservation included.
      expect((await stockOf(productId)).reservedQuantity).toBe(2);
    });
  });

  describe('payments', () => {
    it('records a part payment and reports what is left', async () => {
      const order = await confirmedWith(await makeProduct('PART', '50.00', 5), 1);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '20.00' })
        .expect(201);

      const after = await request(context.server).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      expect(body<OrderBody>(after)).toMatchObject({ paidAmount: '20.00', outstanding: '30.00', paymentStatus: PaymentStatus.PARTIAL });
    });

    it('marks the order paid when the last of it comes in', async () => {
      const order = await confirmedWith(await makeProduct('SETTLE', '50.00', 5), 1);

      for (const amount of ['20.00', '30.00']) {
        await request(context.server)
          .post(`/api/v1/orders/${order.id}/payments`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ method: PaymentMethod.CARD, amount })
          .expect(201);
      }

      const after = await request(context.server).get(`/api/v1/orders/${order.id}`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      expect(body<OrderBody>(after)).toMatchObject({ paidAmount: '50.00', outstanding: '0.00', paymentStatus: PaymentStatus.PAID });
    });

    it('gives every payment a document number', async () => {
      const order = await confirmedWith(await makeProduct('PAYNUM', '10.00', 5), 1);

      const response = await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '10.00' })
        .expect(201);

      expect(body<{ paymentNumber: string }>(response).paymentNumber).toMatch(/^PAY-\d{8}$/);
    });

    it('refuses to take more than is owed, and records nothing', async () => {
      const order = await confirmedWith(await makeProduct('OVER', '10.00', 5), 1);

      const response = await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '10.01' })
        .expect(409);

      expect(errorMessage(response)).toMatch(/more than the 10.00 outstanding/);
      expect(await context.prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
    });

    it('refuses payment against a draft, where nothing has been agreed', async () => {
      const order = await draftWith(await makeProduct('DRAFTPAY', '10.00', 5), 1);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount: '1.00' })
        .expect(409);
    });

    it('accepts payment after completion, for an account settled later', async () => {
      const order = await confirmedWith(await makeProduct('LATEPAY', '10.00', 5), 1);
      await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.BANK_TRANSFER, amount: '10.00' })
        .expect(201);
    });

    it('lists the payments taken against an order', async () => {
      const order = await confirmedWith(await makeProduct('PAYLIST', '30.00', 5), 1);

      for (const amount of ['10.00', '5.00']) {
        await request(context.server)
          .post(`/api/v1/orders/${order.id}/payments`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ method: PaymentMethod.CASH, amount })
          .expect(201);
      }

      const response = await request(context.server).get(`/api/v1/orders/${order.id}/payments`).set('Authorization', `Bearer ${staffToken}`).expect(200);
      expect(body<{ amount: string }[]>(response).map((payment) => payment.amount)).toEqual(['10.00', '5.00']);
    });

    it.each([['0.00'], ['-5.00'], ['1.001']])('rejects an amount of %s', async (amount) => {
      const order = await confirmedWith(await makeProduct(`AMT${amount.replace(/\W/g, '')}`, '10.00', 5), 1);

      await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ method: PaymentMethod.CASH, amount })
        .expect(400);
    });
  });

  describe('listing', () => {
    it('paginates', async () => {
      const response = await request(context.server).get('/api/v1/orders?page=1&limit=2').set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<OrderBody[]>(response).length).toBeLessThanOrEqual(2);
      expect((response.body as ApiResponse<OrderBody[]>).meta.limit).toBe(2);
    });

    it('finds an order by its number', async () => {
      const order = await draftWith(await makeProduct('FINDME', '10.00', 5), 1);

      const response = await request(context.server).get(`/api/v1/orders?search=${order.orderNumber}`).set('Authorization', `Bearer ${staffToken}`).expect(200);

      expect(body<OrderBody[]>(response).map((row) => row.id)).toEqual([order.id]);
    });

    it('filters by status', async () => {
      const response = await request(context.server)
        .get(`/api/v1/orders?status=${OrderStatus.CANCELLED}&limit=100`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(body<OrderBody[]>(response).every((row) => row.status === OrderStatus.CANCELLED)).toBe(true);
    });

    it('filters by customer', async () => {
      const response = await request(context.server)
        .get(`/api/v1/orders?customerId=${customerId}&limit=100`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(body<OrderBody[]>(response).every((row) => row.customerId === customerId)).toBe(true);
    });

    it('refuses a sort column that is not on the whitelist', async () => {
      await request(context.server).get('/api/v1/orders?sortBy=paidAmount').set('Authorization', `Bearer ${staffToken}`).expect(400);
    });

    it('treats a search term containing SQL as text', async () => {
      const response = await request(context.server)
        .get(`/api/v1/orders?search=${encodeURIComponent("' OR 1=1 --")}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(body<OrderBody[]>(response)).toHaveLength(0);
    });

    it('reports a missing order as not found', async () => {
      await request(context.server).get('/api/v1/orders/00000000-0000-4000-8000-00000000dead').set('Authorization', `Bearer ${staffToken}`).expect(404);
    });
  });

  describe('authorisation', () => {
    it('requires authentication', async () => {
      await request(context.server).get('/api/v1/orders').expect(401);
    });

    it('lets a technician read but not sell', async () => {
      await request(context.server).get('/api/v1/orders').set('Authorization', `Bearer ${technicianToken}`).expect(200);
      await request(context.server).post('/api/v1/orders').set('Authorization', `Bearer ${technicianToken}`).send({}).expect(403);
    });

    it('keeps a technician away from confirmation, completion and payment', async () => {
      const order = await confirmedWith(await makeProduct('TECHNO', '10.00', 5), 1);

      await request(context.server).post(`/api/v1/orders/${order.id}/complete`).set('Authorization', `Bearer ${technicianToken}`).expect(403);
      await request(context.server)
        .post(`/api/v1/orders/${order.id}/payments`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ method: PaymentMethod.CASH, amount: '1.00' })
        .expect(403);
    });

    it('lets an admin do everything staff can', async () => {
      const productId = await makeProduct('ADMINSELL', '10.00', 5);
      const created = await request(context.server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId, quantity: 1 }] })
        .expect(201);

      await request(context.server)
        .post(`/api/v1/orders/${body<OrderBody>(created).id}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });
});
