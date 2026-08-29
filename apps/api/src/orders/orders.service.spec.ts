import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { firstCallArg, lastCallArg } from '../common/testing/mock-args';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus, PaymentMethod, PaymentStatus } from '../generated/prisma/enums';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import type { OrderQueryDto } from './dto/order-query.dto';
import { OrdersService } from './orders.service';

const ORDER_ID = '00000000-0000-4000-8000-00000000000a';
const ITEM_ID = '00000000-0000-4000-8000-00000000000b';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c0';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Everything any caller of `order.findUnique` reads, so one default serves all. */
function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORDER_ID,
    status: OrderStatus.DRAFT,
    total: decimal('0.00'),
    paidAmount: decimal('0.00'),
    discount: decimal('0.00'),
    tax: decimal('0.00'),
    ...overrides,
  };
}

function orderQuery(overrides: Partial<OrderQueryDto> = {}): OrderQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', ...overrides };
}

/**
 * The statement a tagged-template call produced, with any embedded
 * `Prisma.Sql` fragment rendered back into place. Bound values are left out:
 * these assertions are about the shape of the statement, not its parameters.
 */
function rawSql(call: unknown[]): string {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];

  return strings.map((part, index) => part + (values[index] instanceof Prisma.Sql ? values[index].sql : '')).join('');
}

describe('OrdersService', () => {
  let service: OrdersService;
  let orderCreate: jest.Mock;
  let orderUpdate: jest.Mock;
  let orderFindUnique: jest.Mock;
  let orderFindUniqueOrThrow: jest.Mock;
  let orderFindMany: jest.Mock;
  let orderCount: jest.Mock;
  let itemCreate: jest.Mock;
  let itemUpdate: jest.Mock;
  let itemDelete: jest.Mock;
  let itemFindMany: jest.Mock;
  let itemFindUnique: jest.Mock;
  let itemCreateMany: jest.Mock;
  let productFindUnique: jest.Mock;
  let productFindMany: jest.Mock;
  let customerFindUnique: jest.Mock;
  let paymentCreate: jest.Mock;
  let executeRaw: jest.Mock;
  let queryRaw: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    orderCreate = jest.fn(() => Promise.resolve({ id: ORDER_ID }));
    orderUpdate = jest.fn(() => Promise.resolve({ id: ORDER_ID }));
    orderFindUnique = jest.fn(() => Promise.resolve(orderRow()));
    orderFindUniqueOrThrow = jest.fn(() =>
      Promise.resolve({ orderNumber: 'ORD-00000042', discount: decimal('0.00'), tax: decimal('0.00'), total: decimal('50.00'), paidAmount: decimal('0.00') }),
    );
    orderFindMany = jest.fn(() => Promise.resolve([]));
    orderCount = jest.fn(() => Promise.resolve(0));

    itemCreate = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemUpdate = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemDelete = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemFindMany = jest.fn(() =>
      Promise.resolve([{ productId: PRODUCT_ID, quantity: 2, unitPrice: decimal('25.00'), discount: decimal('0.00'), product: { sku: 'SPH-AUR-A12' } }]),
    );
    // Two callers share this delegate: the duplicate-product check looks up by
    // (orderId, productId) and must find nothing, while loading a line for
    // update looks up by id and must find it.
    itemFindUnique = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'orderId_productId' in args.where
          ? null
          : { orderId: ORDER_ID, quantity: 2, unitPrice: decimal('25.00'), discount: decimal('0.00'), product: { sku: 'SPH-AUR-A12' } },
      ),
    );

    itemCreateMany = jest.fn(() => Promise.resolve({ count: 1 }));

    productFindUnique = jest.fn(() =>
      Promise.resolve({ sku: 'SPH-AUR-A12', sellingPrice: decimal('25.00'), isActive: true, deletedAt: null, minimumStock: 0, category: { name: 'Phones' } }),
    );
    // The batched lookup `create()` uses for its opening lines; sourced from the same
    // override point (`productFindUnique.mockResolvedValue(...)`) so existing tests that
    // configure a single product's shape work for both the single-item and batch paths.
    productFindMany = jest.fn(async (args: { where: { id: { in: string[] } } }) => {
      const product = (await productFindUnique()) as Record<string, unknown>;
      return args.where.id.in.map((id) => ({ id, ...product }));
    });
    customerFindUnique = jest.fn(() => Promise.resolve({ deletedAt: null }));
    paymentCreate = jest.fn((args: { data: { amount: string } & Record<string, unknown> }) =>
      Promise.resolve({ id: 'payment-1', paymentNumber: 'PAY-00000001', paidAt: new Date(), ...args.data, amount: decimal(args.data.amount) }),
    );

    // The conditional UPDATEs report how many rows they matched.
    executeRaw = jest.fn(() => Promise.resolve(1));
    queryRaw = jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');

      if (sql.includes('nextval')) {
        return Promise.resolve([{ value: '42' }]);
      }
      if (sql.includes('"paidAmount"')) {
        return Promise.resolve([{ paidAmount: '50.00', total: '50.00' }]);
      }

      return Promise.resolve([{ quantity: 4 }]);
    });

    const client = {
      order: {
        create: orderCreate,
        update: orderUpdate,
        findUnique: orderFindUnique,
        findUniqueOrThrow: orderFindUniqueOrThrow,
        findMany: orderFindMany,
        count: orderCount,
      },
      orderItem: { create: itemCreate, createMany: itemCreateMany, update: itemUpdate, delete: itemDelete, findMany: itemFindMany, findUnique: itemFindUnique },
      product: { findUnique: productFindUnique, findMany: productFindMany },
      customer: { findUnique: customerFindUnique },
      payment: { create: paymentCreate, findMany: jest.fn(() => Promise.resolve([])) },
      financialTransaction: { create: jest.fn(() => Promise.resolve({})) },
      inventory: { findUnique: jest.fn(() => Promise.resolve({ quantity: 10, reservedQuantity: 0 })) },
      stockMovement: { createMany: jest.fn(() => Promise.resolve({ count: 1 })) },
      location: { findFirstOrThrow: jest.fn(() => Promise.resolve({ id: 'location-1' })) },
      // Completion consumes stock, which checks for a LOW_STOCK/OUT_OF_STOCK crossing,
      // and every notified event also checks for matching automation rules.
      user: { findMany: jest.fn(() => Promise.resolve([])) },
      notification: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      automationRule: { findMany: jest.fn(() => Promise.resolve([])) },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    };

    transaction = jest.fn((argument: unknown) =>
      typeof argument === 'function' ? (argument as (tx: typeof client) => Promise<unknown>)(client) : Promise.all(argument as Promise<unknown>[]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: TENANT_PRISMA, useValue: { ...client, $transaction: transaction } },
        { provide: AuditService, useValue: { record: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = moduleRef.get(OrdersService);
  });

  describe('findAll', () => {
    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findAll(orderQuery());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns an unfiltered list by default', async () => {
      await service.findAll(orderQuery());

      expect((firstCallArg(orderFindMany) as { where: Prisma.OrderWhereInput }).where).toEqual({});
    });

    it('filters by status, payment status, customer and author together', async () => {
      await service.findAll(orderQuery({ status: OrderStatus.COMPLETED, paymentStatus: PaymentStatus.PAID, customerId: CUSTOMER_ID, createdById: USER_ID }));

      expect((firstCallArg(orderFindMany) as { where: Prisma.OrderWhereInput }).where).toEqual({
        status: OrderStatus.COMPLETED,
        paymentStatus: PaymentStatus.PAID,
        customerId: CUSTOMER_ID,
        createdById: USER_ID,
      });
    });

    it('filters on when the sale closed, separately from when it was raised', async () => {
      const completedFrom = new Date('2026-01-01T00:00:00.000Z');

      await service.findAll(orderQuery({ completedFrom }));

      expect((firstCallArg(orderFindMany) as { where: Prisma.OrderWhereInput }).where.completedAt).toEqual({ gte: completedFrom });
    });

    it('reports what is still owed on every row', async () => {
      orderFindMany.mockResolvedValue([{ total: decimal('50.00'), paidAmount: decimal('20.00') }]);
      orderCount.mockResolvedValue(1);

      const page = await service.findAll(orderQuery());

      expect(page.items[0]?.outstanding.toFixed(2)).toBe('30.00');
    });
  });

  describe('create', () => {
    it('draws an order number from the sequence', async () => {
      await service.create({}, USER_ID);

      const { data } = firstCallArg(orderCreate) as { data: { orderNumber: string } };
      expect(data.orderNumber).toBe('ORD-00000042');
    });

    it('opens the order as a draft owned by the caller', async () => {
      await service.create({ customerId: CUSTOMER_ID }, USER_ID);

      const { data } = firstCallArg(orderCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ customerId: CUSTOMER_ID, createdById: USER_ID });
    });

    it('prices an opening line from the product when no price is given', async () => {
      await service.create({ items: [{ productId: PRODUCT_ID, quantity: 3 }] }, USER_ID);

      const { data } = firstCallArg(itemCreateMany) as { data: { unitPrice: Prisma.Decimal; total: Prisma.Decimal }[] };
      const [line] = data;
      expect(line?.unitPrice.toFixed(2)).toBe('25.00');
      expect(line?.total.toFixed(2)).toBe('75.00');
    });

    it('honours a negotiated price over the catalogue price', async () => {
      await service.create({ items: [{ productId: PRODUCT_ID, quantity: 2, unitPrice: '19.99' }] }, USER_ID);

      const { data } = firstCallArg(itemCreateMany) as { data: { unitPrice: Prisma.Decimal; total: Prisma.Decimal }[] };
      const [line] = data;
      expect(line?.unitPrice.toFixed(2)).toBe('19.99');
      expect(line?.total.toFixed(2)).toBe('39.98');
    });

    it('writes the order, its lines and its totals in a single transaction', async () => {
      await service.create({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, USER_ID);

      // One transaction covering all three writes, so a line that cannot be
      // priced takes the half-built order down with it.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(orderCreate).toHaveBeenCalledTimes(1);
      expect(itemCreateMany).toHaveBeenCalledTimes(1);
      expect(orderUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejects a line whose discount is larger than the goods on it', async () => {
      await expect(service.create({ items: [{ productId: PRODUCT_ID, quantity: 1, discount: '99.00' }] }, USER_ID)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects an order discount larger than the order', async () => {
      itemFindMany.mockResolvedValue([{ quantity: 1, unitPrice: decimal('10.00'), discount: decimal('0.00') }]);

      await expect(service.create({ discount: '11.00' }, USER_ID)).rejects.toThrow(/more than the order comes to/);
    });

    it('refuses a product that has been withdrawn from sale', async () => {
      productFindUnique.mockResolvedValue({ sku: 'SPH-OLD', sellingPrice: decimal('1.00'), isActive: false, deletedAt: null });

      await expect(service.create({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, USER_ID)).rejects.toThrow(/withdrawn from sale/);
    });

    it('refuses a deleted product', async () => {
      productFindUnique.mockResolvedValue({ sku: 'SPH-GONE', sellingPrice: decimal('1.00'), isActive: true, deletedAt: new Date() });

      await expect(service.create({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('refuses a customer who does not exist', async () => {
      customerFindUnique.mockResolvedValue(null);

      await expect(service.create({ customerId: CUSTOMER_ID }, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('accepts a walk-in sale with no customer at all', async () => {
      await service.create({}, USER_ID);

      expect(customerFindUnique).not.toHaveBeenCalled();
      const { data } = firstCallArg(orderCreate) as { data: { customerId: string | null } };
      expect(data.customerId).toBeNull();
    });
  });

  describe('draft edits', () => {
    it('takes the order lock and asserts the draft in one statement', async () => {
      await service.addItem(ORDER_ID, { productId: PRODUCT_ID, quantity: 1 });

      const sql = rawSql(executeRaw.mock.calls[0] as unknown[]);
      expect(sql).toContain('UPDATE "Order"');
      expect(sql).toContain(`"status" = 'DRAFT'`);
    });

    it('refuses to edit an order that is no longer a draft', async () => {
      executeRaw.mockResolvedValue(0);
      orderFindUnique.mockResolvedValue(orderRow({ status: OrderStatus.CONFIRMED }));

      await expect(service.addItem(ORDER_ID, { productId: PRODUCT_ID, quantity: 1 })).rejects.toThrow(/is CONFIRMED; that action needs it to be DRAFT/);
    });

    it('refuses to add a product that is already on the order', async () => {
      itemFindUnique.mockResolvedValue({ id: ITEM_ID });

      await expect(service.addItem(ORDER_ID, { productId: PRODUCT_ID, quantity: 1 })).rejects.toThrow(/already on this order/);
    });

    it('re-prices the order from its lines after a line changes', async () => {
      itemFindMany.mockResolvedValue([
        { quantity: 2, unitPrice: decimal('25.00'), discount: decimal('0.00') },
        { quantity: 1, unitPrice: decimal('5.50'), discount: decimal('0.50') },
      ]);

      await service.addItem(ORDER_ID, { productId: PRODUCT_ID, quantity: 1 });

      const update = lastCallArg(orderUpdate) as { data: { subtotal: Prisma.Decimal; total: Prisma.Decimal } };
      expect(update.data.subtotal.toFixed(2)).toBe('55.00');
      expect(update.data.total.toFixed(2)).toBe('55.00');
    });

    it('keeps the existing values for fields a line update leaves out', async () => {
      await service.updateItem(ORDER_ID, ITEM_ID, { quantity: 4 });

      const { data } = firstCallArg(itemUpdate) as { data: { quantity: number; unitPrice: Prisma.Decimal; total: Prisma.Decimal } };
      expect(data.quantity).toBe(4);
      expect(data.unitPrice.toFixed(2)).toBe('25.00');
      expect(data.total.toFixed(2)).toBe('100.00');
    });

    it('refuses a line update whose discount exceeds the line', async () => {
      await expect(service.updateItem(ORDER_ID, ITEM_ID, { discount: '60.00' })).rejects.toThrow(/more than the line comes to/);
    });

    it('refuses to touch an item that belongs to another order', async () => {
      itemFindUnique.mockResolvedValue({ orderId: 'another-order', quantity: 1, unitPrice: decimal('1.00'), discount: decimal('0.00'), product: { sku: 'X' } });

      await expect(service.removeItem(ORDER_ID, ITEM_ID)).rejects.toThrow(NotFoundException);
    });

    it('refuses to touch an item that does not exist', async () => {
      itemFindUnique.mockResolvedValue(null);

      await expect(service.removeItem(ORDER_ID, ITEM_ID)).rejects.toThrow(NotFoundException);
    });

    it('removes the line and re-prices what is left', async () => {
      await service.removeItem(ORDER_ID, ITEM_ID);

      expect(itemDelete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
      expect(orderUpdate).toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('moves the order out of DRAFT with a conditional update', async () => {
      await service.confirm(ORDER_ID);

      const sql = rawSql(executeRaw.mock.calls[0] as unknown[]);
      expect(sql).toContain('UPDATE "Order"');
      expect(sql).toContain('SET "status" =');
    });

    it('refuses an order with no lines on it', async () => {
      itemFindMany.mockResolvedValue([]);

      await expect(service.confirm(ORDER_ID)).rejects.toThrow(/needs at least one item/);
    });

    it('does not stamp a completion time', async () => {
      await service.confirm(ORDER_ID);

      expect(rawSql(executeRaw.mock.calls[0] as unknown[])).not.toContain('completedAt');
    });

    it('reports a missing order as not found rather than as a conflict', async () => {
      executeRaw.mockResolvedValue(0);
      orderFindUnique.mockResolvedValue(null);

      await expect(service.confirm(ORDER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('complete', () => {
    it('stamps the completion time, which is what revenue is reported on', async () => {
      await service.complete(ORDER_ID, USER_ID);

      expect(rawSql(executeRaw.mock.calls[0] as unknown[])).toContain('"completedAt" = NOW()');
    });

    it('refuses an order that was never confirmed', async () => {
      executeRaw.mockResolvedValue(0);
      orderFindUnique.mockResolvedValue(orderRow({ status: OrderStatus.DRAFT }));

      await expect(service.complete(ORDER_ID, USER_ID)).rejects.toThrow(/is DRAFT; that action needs it to be CONFIRMED/);
    });
  });

  describe('cancel', () => {
    it('releases the reservation of a confirmed order', async () => {
      orderFindUnique.mockResolvedValue(orderRow({ status: OrderStatus.CONFIRMED }));
      itemFindMany.mockResolvedValue([{ productId: PRODUCT_ID, quantity: 2, product: { sku: 'SPH-AUR-A12' } }]);

      await service.cancel(ORDER_ID, USER_ID);

      const released = executeRaw.mock.calls.some((call) => rawSql(call as unknown[]).includes('"reservedQuantity" - '));
      expect(released).toBe(true);
    });

    it('releases nothing for a draft, which never reserved anything', async () => {
      orderFindUnique.mockResolvedValue(orderRow({ status: OrderStatus.DRAFT }));

      await service.cancel(ORDER_ID, USER_ID);

      const touchedInventory = executeRaw.mock.calls.some((call) => rawSql(call as unknown[]).includes('"Inventory"'));
      expect(touchedInventory).toBe(false);
    });

    it('refuses to cancel an order that has money against it', async () => {
      orderFindUnique.mockResolvedValue(orderRow({ status: OrderStatus.CONFIRMED }));
      orderFindUniqueOrThrow.mockResolvedValue({ paidAmount: decimal('20.00') });

      await expect(service.cancel(ORDER_ID, USER_ID)).rejects.toThrow(/refund the payment before cancelling/);
    });

    it('reports a missing order as not found', async () => {
      orderFindUnique.mockResolvedValue(null);

      await expect(service.cancel(ORDER_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('addPayment', () => {
    it('raises the paid amount in the same statement that checks there is room', async () => {
      await service.addPayment(ORDER_ID, { method: PaymentMethod.CASH, amount: '50.00' }, USER_ID);

      const sql = queryRaw.mock.calls.map((call) => rawSql(call as unknown[])).find((statement) => statement.includes('"paidAmount" + ')) ?? '';
      expect(sql).toContain('"paidAmount" = "paidAmount" + ');
      expect(sql).toContain('<= "total"');
    });

    it('draws a payment number and files the payment against the order', async () => {
      await service.addPayment(ORDER_ID, { method: PaymentMethod.CARD, amount: '50.00', reference: 'auth-991' }, USER_ID);

      const { data } = firstCallArg(paymentCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({
        paymentNumber: 'PAY-00000042',
        method: PaymentMethod.CARD,
        amount: '50.00',
        orderId: ORDER_ID,
        reference: 'auth-991',
        createdById: USER_ID,
      });
    });

    it('marks the order paid once the full amount is in', async () => {
      await service.addPayment(ORDER_ID, { method: PaymentMethod.CASH, amount: '50.00' }, USER_ID);

      const update = lastCallArg(orderUpdate) as { data: { paymentStatus: PaymentStatus } };
      expect(update.data.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('marks the order part-paid when something is still owed', async () => {
      queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('nextval')) {
          return Promise.resolve([{ value: '42' }]);
        }
        return Promise.resolve([{ paidAmount: '20.00', total: '50.00' }]);
      });

      await service.addPayment(ORDER_ID, { method: PaymentMethod.CASH, amount: '20.00' }, USER_ID);

      const update = lastCallArg(orderUpdate) as { data: { paymentStatus: PaymentStatus } };
      expect(update.data.paymentStatus).toBe(PaymentStatus.PARTIAL);
    });

    it('writes no payment when the amount is refused', async () => {
      queryRaw.mockResolvedValue([]);
      orderFindUnique.mockResolvedValue(orderRow({ status: OrderStatus.CONFIRMED, total: decimal('50.00'), paidAmount: decimal('45.00') }));

      await expect(service.addPayment(ORDER_ID, { method: PaymentMethod.CASH, amount: '10.00' }, USER_ID)).rejects.toThrow(
        /10.00 is more than the 5.00 outstanding/,
      );
      expect(paymentCreate).not.toHaveBeenCalled();
    });

    it('refuses payment against a draft, where nothing has been agreed', async () => {
      queryRaw.mockResolvedValue([]);
      orderFindUnique.mockResolvedValue(orderRow({ status: OrderStatus.DRAFT, total: decimal('50.00'), paidAmount: decimal('0.00') }));

      await expect(service.addPayment(ORDER_ID, { method: PaymentMethod.CASH, amount: '10.00' }, USER_ID)).rejects.toThrow(ConflictException);
    });
  });
});
