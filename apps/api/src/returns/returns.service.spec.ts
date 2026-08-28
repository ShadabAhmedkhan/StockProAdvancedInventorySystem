import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { firstCallArg, lastCallArg } from '../common/testing/mock-args';
import { Prisma } from '../generated/prisma/client';
import {
  OrderStatus,
  PaymentMethod,
  PaymentReferenceType,
  PaymentStatus,
  ReturnReason,
  ReturnStatus,
  StockMovementType,
  StockReferenceType,
} from '../generated/prisma/enums';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import type { ReturnQueryDto } from './dto/return-query.dto';
import { ReturnsService } from './returns.service';

const RETURN_ID = '00000000-0000-4000-8000-00000000000a';
const ITEM_ID = '00000000-0000-4000-8000-00000000000b';
const ORDER_ID = '00000000-0000-4000-8000-00000000000c';
const ORDER_ITEM_ID = '00000000-0000-4000-8000-00000000000d';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function returnRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RETURN_ID,
    orderId: ORDER_ID,
    status: ReturnStatus.PENDING,
    refundAmount: decimal('50.00'),
    items: [],
    payments: [],
    ...overrides,
  };
}

function returnQuery(overrides: Partial<ReturnQueryDto> = {}): ReturnQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', ...overrides };
}

/** Renders a tagged-template call, putting embedded `Prisma.Sql` back in place. */
function rawSql(call: unknown[]): string {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];

  return strings.map((part, index) => part + (values[index] instanceof Prisma.Sql ? values[index].sql : '')).join('');
}

describe('ReturnsService', () => {
  let service: ReturnsService;
  let returnCreate: jest.Mock;
  let returnUpdate: jest.Mock;
  let returnFindUnique: jest.Mock;
  let returnFindMany: jest.Mock;
  let returnCount: jest.Mock;
  let itemCreate: jest.Mock;
  let itemUpdate: jest.Mock;
  let itemDelete: jest.Mock;
  let itemFindMany: jest.Mock;
  let itemFindUnique: jest.Mock;
  let itemCount: jest.Mock;
  let itemAggregate: jest.Mock;
  let orderItemFindUnique: jest.Mock;
  let orderItemFindUniqueOrThrow: jest.Mock;
  let orderUpdate: jest.Mock;
  let paymentCreate: jest.Mock;
  let paymentAggregate: jest.Mock;
  let movementCreateMany: jest.Mock;
  let queryRaw: jest.Mock;
  let transaction: jest.Mock;

  /** The order the lock statement reports, tweakable per test. */
  let lockedOrder: Record<string, unknown>;
  /** What the transition statement reports back, or nothing when it matched none. */
  let transitionRows: Record<string, unknown>[];

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    lockedOrder = { orderNumber: 'ORD-00000001', status: OrderStatus.COMPLETED, customerId: null, paidAmount: '100.00' };
    // Serves both the pending-lock (which reads `orderId`) and the status
    // transition (which reads the credit back).
    transitionRows = [{ refundAmount: '50.00', orderId: ORDER_ID }];

    returnCreate = jest.fn(() => Promise.resolve({ id: RETURN_ID }));
    returnUpdate = jest.fn(() => Promise.resolve({ id: RETURN_ID }));
    returnFindUnique = jest.fn(() => Promise.resolve(returnRow()));
    returnFindMany = jest.fn(() => Promise.resolve([]));
    returnCount = jest.fn(() => Promise.resolve(0));

    itemCreate = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemUpdate = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemDelete = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemFindMany = jest.fn(() => Promise.resolve([{ productId: PRODUCT_ID, quantity: 2, total: decimal('50.00'), product: { sku: 'SPH-AUR-A12' } }]));
    itemFindUnique = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'returnId_orderItemId' in args.where
          ? null
          : { id: ITEM_ID, returnId: RETURN_ID, orderItemId: ORDER_ITEM_ID, quantity: 2, product: { sku: 'SPH-AUR-A12' } },
      ),
    );
    itemCount = jest.fn(() => Promise.resolve(2));
    itemAggregate = jest.fn(() => Promise.resolve({ _sum: { quantity: null, total: null } }));

    // A line of three units charged 50.00 in total.
    orderItemFindUnique = jest.fn(() =>
      Promise.resolve({
        orderId: ORDER_ID,
        productId: PRODUCT_ID,
        quantity: 3,
        unitPrice: decimal('20.00'),
        total: decimal('50.00'),
        product: { sku: 'SPH-AUR-A12' },
      }),
    );
    orderItemFindUniqueOrThrow = jest.fn(() => Promise.resolve({ quantity: 3, total: decimal('50.00') }));
    orderUpdate = jest.fn(() => Promise.resolve({ id: ORDER_ID }));

    paymentCreate = jest.fn((args: { data: { amount: string; paymentNumber: string } & Record<string, unknown> }) =>
      Promise.resolve({ id: 'payment-1', paidAt: new Date(), ...args.data, amount: decimal(args.data.amount) }),
    );
    paymentAggregate = jest.fn(() => Promise.resolve({ _sum: { amount: null } }));
    movementCreateMany = jest.fn(() => Promise.resolve({ count: 1 }));

    queryRaw = jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');

      if (sql.includes('nextval')) {
        return Promise.resolve([{ value: '42' }]);
      }
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve([lockedOrder]);
      }
      if (sql.includes('UPDATE "Return"')) {
        return Promise.resolve(transitionRows);
      }

      return Promise.resolve([{ quantity: 9 }]);
    });

    const client = {
      return: { create: returnCreate, update: returnUpdate, findUnique: returnFindUnique, findMany: returnFindMany, count: returnCount },
      returnItem: {
        create: itemCreate,
        update: itemUpdate,
        delete: itemDelete,
        findMany: itemFindMany,
        findUnique: itemFindUnique,
        count: itemCount,
        aggregate: itemAggregate,
      },
      orderItem: { findUnique: orderItemFindUnique, findUniqueOrThrow: orderItemFindUniqueOrThrow },
      order: { update: orderUpdate },
      payment: { create: paymentCreate, aggregate: paymentAggregate, findMany: jest.fn(() => Promise.resolve([])) },
      financialTransaction: { create: jest.fn(() => Promise.resolve({})) },
      stockMovement: { createMany: movementCreateMany },
      location: { findFirstOrThrow: jest.fn(() => Promise.resolve({ id: 'location-1' })) },
      $queryRaw: queryRaw,
    };

    transaction = jest.fn((argument: unknown) =>
      typeof argument === 'function' ? (argument as (tx: typeof client) => Promise<unknown>)(client) : Promise.all(argument as Promise<unknown>[]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: TENANT_PRISMA, useValue: { ...client, $transaction: transaction } },
        { provide: AuditService, useValue: { record: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = moduleRef.get(ReturnsService);
  });

  const intake = { orderId: ORDER_ID, reason: ReturnReason.DEFECTIVE, items: [{ orderItemId: ORDER_ITEM_ID, quantity: 1, restock: true }] };

  describe('raising a return', () => {
    it('draws a return number from the sequence', async () => {
      await service.create(intake, USER_ID);

      const { data } = firstCallArg(returnCreate) as { data: { returnNumber: string } };
      expect(data.returnNumber).toBe('RET-00000042');
    });

    it('locks the order before working out what is still returnable', async () => {
      await service.create(intake, USER_ID);

      const locked = queryRaw.mock.calls.map((call) => rawSql(call as unknown[])).some((sql) => sql.includes('FOR UPDATE'));
      expect(locked).toBe(true);
    });

    it('takes the customer from the order rather than the request', async () => {
      lockedOrder = { ...lockedOrder, customerId: 'customer-from-order' };

      await service.create(intake, USER_ID);

      const { data } = firstCallArg(returnCreate) as { data: { customerId: string | null } };
      expect(data.customerId).toBe('customer-from-order');
    });

    it('refuses goods from an order that never went out', async () => {
      lockedOrder = { ...lockedOrder, status: OrderStatus.CONFIRMED };

      await expect(service.create(intake, USER_ID)).rejects.toThrow(/goods can only come back from an order that has been completed/);
    });

    it('refuses an order that does not exist', async () => {
      queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        strings.join(' ').includes('FOR UPDATE') ? Promise.resolve([]) : Promise.resolve([{ value: '42' }]),
      );

      await expect(service.create(intake, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('refuses a line that belongs to a different order', async () => {
      orderItemFindUnique.mockResolvedValue({
        orderId: 'another-order',
        productId: PRODUCT_ID,
        quantity: 3,
        unitPrice: decimal('20.00'),
        total: decimal('50.00'),
        product: { sku: 'X' },
      });

      await expect(service.create(intake, USER_ID)).rejects.toThrow(/not on the order this return is against/);
    });

    it('refuses more units than the line has left', async () => {
      itemAggregate.mockResolvedValue({ _sum: { quantity: 2, total: decimal('33.34') } });

      await expect(service.create({ ...intake, items: [{ orderItemId: ORDER_ITEM_ID, quantity: 2, restock: true }] }, USER_ID)).rejects.toThrow(
        /Only 1 of 3 SPH-AUR-A12 are still open to return; 2 were asked for/,
      );
    });

    it('prices the line from what was charged, not the list price', async () => {
      // Three units charged 50.00 in total: one back is 16.67, not 20.00.
      await service.create(intake, USER_ID);

      const { data } = firstCallArg(itemCreate) as { data: { total: Prisma.Decimal; unitPrice: Prisma.Decimal } };
      expect(data.total.toFixed(2)).toBe('16.67');
      expect(data.unitPrice.toFixed(2)).toBe('20.00');
    });

    it('hands back exactly what is left when the last units come home', async () => {
      itemAggregate.mockResolvedValue({ _sum: { quantity: 2, total: decimal('33.34') } });

      await service.create(intake, USER_ID);

      const { data } = firstCallArg(itemCreate) as { data: { total: Prisma.Decimal } };
      expect(data.total.toFixed(2)).toBe('16.66');
    });

    it('stores the credit as the sum of its lines', async () => {
      itemFindMany.mockResolvedValue([{ total: decimal('16.67') }, { total: decimal('12.50') }]);

      await service.create(intake, USER_ID);

      const { data } = lastCallArg(returnUpdate) as { data: { refundAmount: Prisma.Decimal } };
      expect(data.refundAmount.toFixed(2)).toBe('29.17');
    });

    it('refuses the same order line twice on one return', async () => {
      itemFindUnique.mockResolvedValue({ id: ITEM_ID });

      await expect(service.create(intake, USER_ID)).rejects.toThrow(/already on this return/);
    });

    it('does everything in one transaction', async () => {
      await service.create(intake, USER_ID);

      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('editing a pending return', () => {
    it('takes the return lock and asserts it is still pending', async () => {
      await service.addItem(RETURN_ID, { orderItemId: ORDER_ITEM_ID, quantity: 1, restock: true });

      const sql = queryRaw.mock.calls.map((call) => rawSql(call as unknown[])).find((statement) => statement.includes('UPDATE "Return"')) ?? '';
      expect(sql).toContain(`"status" = 'PENDING'`);
    });

    it('refuses to edit a return that has been approved', async () => {
      transitionRows = [];
      returnFindUnique.mockResolvedValue(returnRow({ status: ReturnStatus.APPROVED }));

      await expect(service.addItem(RETURN_ID, { orderItemId: ORDER_ITEM_ID, quantity: 1, restock: true })).rejects.toThrow(
        /is APPROVED; that action needs it to be PENDING/,
      );
    });

    it('measures a quantity change against every other return, not itself', async () => {
      await service.updateItem(RETURN_ID, ITEM_ID, { quantity: 3 });

      const call = firstCallArg(itemAggregate) as { where: { id?: { not: string } } };
      expect(call.where.id).toEqual({ not: ITEM_ID });
    });

    it('re-prices the line when its quantity changes', async () => {
      await service.updateItem(RETURN_ID, ITEM_ID, { quantity: 3 });

      const { data } = firstCallArg(itemUpdate) as { data: { total: Prisma.Decimal } };
      expect(data.total.toFixed(2)).toBe('50.00');
    });

    it('moves no money when only restockability changes', async () => {
      await service.updateItem(RETURN_ID, ITEM_ID, { restock: false });

      const { data } = firstCallArg(itemUpdate) as { data: { restock?: boolean; total: Prisma.Decimal } };
      expect(data.restock).toBe(false);
      expect(data.total.toFixed(2)).toBe('33.33');
    });

    it('refuses to empty a return of its last line', async () => {
      itemCount.mockResolvedValue(1);

      await expect(service.removeItem(RETURN_ID, ITEM_ID)).rejects.toThrow(/reject the return instead of emptying it/);
      expect(itemDelete).not.toHaveBeenCalled();
    });

    it('removes a line and re-prices what is left', async () => {
      await service.removeItem(RETURN_ID, ITEM_ID);

      expect(itemDelete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
      expect(returnUpdate).toHaveBeenCalled();
    });

    it('refuses to touch a line on another return', async () => {
      itemFindUnique.mockResolvedValue({ id: ITEM_ID, returnId: 'another', orderItemId: ORDER_ITEM_ID, quantity: 1, product: { sku: 'X' } });

      await expect(service.removeItem(RETURN_ID, ITEM_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('approving and rejecting', () => {
    it('approves without moving stock or money', async () => {
      await service.approve(RETURN_ID, USER_ID);

      expect(movementCreateMany).not.toHaveBeenCalled();
      expect(paymentCreate).not.toHaveBeenCalled();
    });

    it('refuses to approve a return somebody already decided', async () => {
      transitionRows = [];
      returnFindUnique.mockResolvedValue(returnRow({ status: ReturnStatus.REJECTED }));

      await expect(service.approve(RETURN_ID, USER_ID)).rejects.toThrow(/is REJECTED, which is final/);
    });

    it('rejects a pending return without touching stock', async () => {
      await service.reject(RETURN_ID);

      expect(movementCreateMany).not.toHaveBeenCalled();
    });

    it('reports a missing return as not found', async () => {
      transitionRows = [];
      returnFindUnique.mockResolvedValue(null);

      await expect(service.approve(RETURN_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('completing', () => {
    const refund = { method: PaymentMethod.CASH };

    it('puts the sellable goods back and says why', async () => {
      await service.complete(RETURN_ID, refund, USER_ID);

      const { data } = firstCallArg(movementCreateMany) as { data: Record<string, unknown>[] };
      expect(data[0]).toMatchObject({
        productId: PRODUCT_ID,
        type: StockMovementType.RETURN_IN,
        quantity: 2,
        referenceType: StockReferenceType.RETURN,
        referenceId: RETURN_ID,
        createdById: USER_ID,
      });
    });

    it('writes the refund against the return', async () => {
      await service.complete(RETURN_ID, { method: PaymentMethod.CARD, reference: 'refund-9' }, USER_ID);

      const { data } = firstCallArg(paymentCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({
        paymentNumber: 'PAY-00000042',
        method: PaymentMethod.CARD,
        referenceType: PaymentReferenceType.RETURN,
        returnId: RETURN_ID,
        reference: 'refund-9',
        createdById: USER_ID,
      });
      expect((data.amount as Prisma.Decimal).toFixed(2)).toBe('50.00');
    });

    it('restores nothing for goods that came back broken', async () => {
      itemFindMany.mockResolvedValue([]);

      await service.complete(RETURN_ID, refund, USER_ID);

      // The customer is still credited; the units are simply written off.
      expect(movementCreateMany).not.toHaveBeenCalled();
      expect(paymentCreate).toHaveBeenCalled();
    });

    it('caps the money at what the customer actually paid', async () => {
      lockedOrder = { ...lockedOrder, paidAmount: '20.00' };

      await service.complete(RETURN_ID, refund, USER_ID);

      const { data } = firstCallArg(paymentCreate) as { data: { amount: Prisma.Decimal } };
      expect(data.amount.toFixed(2)).toBe('20.00');
    });

    it('counts refunds already made against the same order', async () => {
      paymentAggregate.mockResolvedValue({ _sum: { amount: decimal('90.00') } });

      await service.complete(RETURN_ID, refund, USER_ID);

      const { data } = firstCallArg(paymentCreate) as { data: { amount: Prisma.Decimal } };
      expect(data.amount.toFixed(2)).toBe('10.00');
    });

    it('writes no refund at all against an order nobody paid for', async () => {
      lockedOrder = { ...lockedOrder, paidAmount: '0.00' };

      await service.complete(RETURN_ID, refund, USER_ID);

      // Stock still comes back; there is simply no money to hand over.
      expect(movementCreateMany).toHaveBeenCalled();
      expect(paymentCreate).not.toHaveBeenCalled();
    });

    it('marks the order refunded once everything collected has gone back', async () => {
      lockedOrder = { ...lockedOrder, paidAmount: '50.00' };

      await service.complete(RETURN_ID, refund, USER_ID);

      const { data } = lastCallArg(orderUpdate) as { data: { paymentStatus: PaymentStatus } };
      expect(data.paymentStatus).toBe(PaymentStatus.REFUNDED);
    });

    it('leaves a part-refunded order alone', async () => {
      lockedOrder = { ...lockedOrder, paidAmount: '100.00' };

      await service.complete(RETURN_ID, refund, USER_ID);

      expect(orderUpdate).not.toHaveBeenCalled();
    });

    it('refuses to complete a return nobody approved', async () => {
      transitionRows = [];
      returnFindUnique.mockResolvedValue(returnRow({ status: ReturnStatus.PENDING }));

      await expect(service.complete(RETURN_ID, refund, USER_ID)).rejects.toThrow(ConflictException);
      expect(movementCreateMany).not.toHaveBeenCalled();
      expect(paymentCreate).not.toHaveBeenCalled();
    });

    it('stamps the completion time', async () => {
      await service.complete(RETURN_ID, refund, USER_ID);

      const sql = queryRaw.mock.calls.map((call) => rawSql(call as unknown[])).find((statement) => statement.includes('SET "status"')) ?? '';
      expect(sql).toContain('"completedAt" = NOW()');
    });

    it('does everything in one transaction', async () => {
      await service.complete(RETURN_ID, refund, USER_ID);

      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    function capturedWhere(): Prisma.ReturnWhereInput {
      return (firstCallArg(returnFindMany) as { where: Prisma.ReturnWhereInput }).where;
    }

    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findAll(returnQuery());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns an unfiltered list by default', async () => {
      await service.findAll(returnQuery());

      expect(capturedWhere()).toEqual({});
    });

    it('filters by status, reason and order together', async () => {
      await service.findAll(returnQuery({ status: ReturnStatus.COMPLETED, reason: ReturnReason.DAMAGED, orderId: ORDER_ID }));

      expect(capturedWhere()).toEqual({ status: ReturnStatus.COMPLETED, reason: ReturnReason.DAMAGED, orderId: ORDER_ID });
    });

    it('reports the credit still owed on every row', async () => {
      returnFindMany.mockResolvedValue([{ refundAmount: decimal('50.00'), payments: [{ amount: decimal('20.00') }] }]);
      returnCount.mockResolvedValue(1);

      const page = await service.findAll(returnQuery());

      expect(page.items[0]?.paidBackAmount.toFixed(2)).toBe('20.00');
      expect(page.items[0]?.outstandingCredit.toFixed(2)).toBe('30.00');
    });
  });
});
