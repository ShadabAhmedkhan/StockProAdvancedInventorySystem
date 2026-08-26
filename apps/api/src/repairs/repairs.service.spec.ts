import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { firstCallArg, lastCallArg } from '../common/testing/mock-args';
import { Prisma } from '../generated/prisma/client';
import { DeviceType, PaymentMethod, RepairStatus, StockMovementType, StockReferenceType, UserRole, UserStatus } from '../generated/prisma/enums';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import type { RepairQueryDto } from './dto/repair-query.dto';
import { RepairsService } from './repairs.service';

const REPAIR_ID = '00000000-0000-4000-8000-00000000000a';
const ITEM_ID = '00000000-0000-4000-8000-00000000000b';
const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c0';
const TECHNICIAN_ID = '00000000-0000-4000-8000-0000000000e0';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Everything any caller of `repair.findUnique` reads, so one default serves all. */
function repairRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REPAIR_ID,
    status: RepairStatus.IN_PROGRESS,
    finalCost: decimal('120.00'),
    items: [],
    payments: [],
    statusHistory: [],
    ...overrides,
  };
}

function repairQuery(overrides: Partial<RepairQueryDto> = {}): RepairQueryDto {
  return { page: 1, limit: 20, sortBy: 'receivedAt', sortOrder: 'desc', ...overrides };
}

/** Renders a tagged-template call, putting embedded `Prisma.Sql` back in place. */
function rawSql(call: unknown[]): string {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];

  return strings.map((part, index) => part + (values[index] instanceof Prisma.Sql ? values[index].sql : '')).join('');
}

describe('RepairsService', () => {
  let service: RepairsService;
  let repairCreate: jest.Mock;
  let repairUpdate: jest.Mock;
  let repairFindUnique: jest.Mock;
  let repairFindMany: jest.Mock;
  let repairCount: jest.Mock;
  let historyCreate: jest.Mock;
  let itemCreate: jest.Mock;
  let itemUpdate: jest.Mock;
  let itemDelete: jest.Mock;
  let itemFindMany: jest.Mock;
  let itemFindUnique: jest.Mock;
  let productFindUnique: jest.Mock;
  let customerFindUnique: jest.Mock;
  let userFindUnique: jest.Mock;
  let paymentCreate: jest.Mock;
  let paymentAggregate: jest.Mock;
  let movementCreateMany: jest.Mock;
  let executeRaw: jest.Mock;
  let queryRaw: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    repairCreate = jest.fn(() => Promise.resolve({ id: REPAIR_ID }));
    repairUpdate = jest.fn(() => Promise.resolve({ id: REPAIR_ID }));
    repairFindUnique = jest.fn(() => Promise.resolve(repairRow()));
    repairFindMany = jest.fn(() => Promise.resolve([]));
    repairCount = jest.fn(() => Promise.resolve(0));
    historyCreate = jest.fn(() => Promise.resolve({ id: 'history-1' }));

    itemCreate = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemUpdate = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemDelete = jest.fn(() => Promise.resolve({ id: ITEM_ID }));
    itemFindMany = jest.fn(() => Promise.resolve([{ productId: PRODUCT_ID, quantity: 2, product: { sku: 'PRT-SCR-NIM7' } }]));
    itemFindUnique = jest.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(
        'repairId_productId' in args.where
          ? null
          : { repairId: REPAIR_ID, productId: PRODUCT_ID, quantity: 2, unitPrice: decimal('30.00'), product: { sku: 'PRT-SCR-NIM7' } },
      ),
    );

    productFindUnique = jest.fn(() => Promise.resolve({ sku: 'PRT-SCR-NIM7', sellingPrice: decimal('30.00'), isActive: true, deletedAt: null }));
    customerFindUnique = jest.fn(() => Promise.resolve({ deletedAt: null }));
    userFindUnique = jest.fn(() => Promise.resolve({ role: UserRole.TECHNICIAN, status: UserStatus.ACTIVE }));
    paymentCreate = jest.fn((args: { data: { amount: string } & Record<string, unknown> }) =>
      Promise.resolve({ id: 'payment-1', paymentNumber: 'PAY-00000042', paidAt: new Date(), ...args.data, amount: decimal(args.data.amount) }),
    );
    paymentAggregate = jest.fn(() => Promise.resolve({ _sum: { amount: null } }));
    movementCreateMany = jest.fn(() => Promise.resolve({ count: 1 }));

    executeRaw = jest.fn(() => Promise.resolve(1));
    queryRaw = jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');

      if (sql.includes('nextval')) {
        return Promise.resolve([{ value: '42' }]);
      }
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve([{ status: RepairStatus.COMPLETED, finalCost: '120.00' }]);
      }

      return Promise.resolve([{ quantity: 4 }]);
    });

    const client = {
      repair: { create: repairCreate, update: repairUpdate, findUnique: repairFindUnique, findMany: repairFindMany, count: repairCount },
      repairItem: { create: itemCreate, update: itemUpdate, delete: itemDelete, findMany: itemFindMany, findUnique: itemFindUnique },
      repairStatusHistory: { create: historyCreate, findMany: jest.fn(() => Promise.resolve([])) },
      product: { findUnique: productFindUnique },
      customer: { findUnique: customerFindUnique },
      user: { findUnique: userFindUnique },
      payment: { create: paymentCreate, aggregate: paymentAggregate, findMany: jest.fn(() => Promise.resolve([])) },
      financialTransaction: { create: jest.fn(() => Promise.resolve({})) },
      inventory: { findUnique: jest.fn(() => Promise.resolve({ quantity: 10, reservedQuantity: 0 })) },
      stockMovement: { createMany: movementCreateMany },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    };

    transaction = jest.fn((argument: unknown) =>
      typeof argument === 'function' ? (argument as (tx: typeof client) => Promise<unknown>)(client) : Promise.all(argument as Promise<unknown>[]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        RepairsService,
        { provide: TENANT_PRISMA, useValue: { ...client, $transaction: transaction } },
        { provide: AuditService, useValue: { record: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = moduleRef.get(RepairsService);
  });

  describe('intake', () => {
    const intake = { customerId: CUSTOMER_ID, deviceType: DeviceType.PHONE, problemDescription: 'Screen cracked' };

    it('draws a repair number from the sequence', async () => {
      await service.create(intake, USER_ID);

      const { data } = firstCallArg(repairCreate) as { data: { repairNumber: string } };
      expect(data.repairNumber).toBe('REP-00000042');
    });

    it('opens the history with an intake row that came from nowhere', async () => {
      await service.create(intake, USER_ID);

      const { data } = firstCallArg(historyCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ fromStatus: null, toStatus: RepairStatus.RECEIVED, changedById: USER_ID });
    });

    it('writes the repair and its first history row in one transaction', async () => {
      await service.create(intake, USER_ID);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(repairCreate).toHaveBeenCalledTimes(1);
      expect(historyCreate).toHaveBeenCalledTimes(1);
    });

    it('refuses a customer who does not exist', async () => {
      customerFindUnique.mockResolvedValue(null);

      await expect(service.create(intake, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('refuses to assign work to a salesperson', async () => {
      userFindUnique.mockResolvedValue({ role: UserRole.STAFF, status: UserStatus.ACTIVE });

      await expect(service.create({ ...intake, technicianId: TECHNICIAN_ID }, USER_ID)).rejects.toThrow(/active technician, manager or administrator/);
    });

    it('refuses to assign work to a deactivated account', async () => {
      userFindUnique.mockResolvedValue({ role: UserRole.TECHNICIAN, status: UserStatus.INACTIVE });

      await expect(service.create({ ...intake, technicianId: TECHNICIAN_ID }, USER_ID)).rejects.toThrow(UnprocessableEntityException);
    });

    it('accepts a repair with nobody assigned yet', async () => {
      await service.create(intake, USER_ID);

      expect(userFindUnique).not.toHaveBeenCalled();
      const { data } = firstCallArg(repairCreate) as { data: { technicianId: string | null } };
      expect(data.technicianId).toBeNull();
    });
  });

  describe('changing status', () => {
    it('records who moved it, from what, to what, and why', async () => {
      repairFindUnique.mockResolvedValue(repairRow({ status: RepairStatus.RECEIVED }));

      await service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.DIAGNOSING, note: 'On the bench' }, USER_ID);

      const { data } = firstCallArg(historyCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({
        repairId: REPAIR_ID,
        fromStatus: RepairStatus.RECEIVED,
        toStatus: RepairStatus.DIAGNOSING,
        note: 'On the bench',
        changedById: USER_ID,
      });
    });

    it('refuses a move the workflow does not allow', async () => {
      repairFindUnique.mockResolvedValue(repairRow({ status: RepairStatus.RECEIVED }));

      await expect(service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.COMPLETED }, USER_ID)).rejects.toThrow(
        /A RECEIVED repair cannot become COMPLETED; it can only become DIAGNOSING or CANCELLED/,
      );
    });

    it('says so plainly when the repair is already finished', async () => {
      repairFindUnique.mockResolvedValue(repairRow({ status: RepairStatus.DELIVERED }));

      await expect(service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.IN_PROGRESS }, USER_ID)).rejects.toThrow(/is DELIVERED, which is final/);
    });

    it('writes no history row for a refused move', async () => {
      repairFindUnique.mockResolvedValue(repairRow({ status: RepairStatus.RECEIVED }));

      await expect(service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.DELIVERED }, USER_ID)).rejects.toThrow(ConflictException);
      expect(historyCreate).not.toHaveBeenCalled();
    });

    it('refuses to complete a repair nobody has priced', async () => {
      repairFindUnique.mockResolvedValue(repairRow({ status: RepairStatus.IN_PROGRESS, finalCost: null }));

      await expect(service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.COMPLETED }, USER_ID)).rejects.toThrow(/Set the final cost before completing/);
      expect(movementCreateMany).not.toHaveBeenCalled();
    });

    it('consumes the fitted parts on completion, attributing them to the repair', async () => {
      await service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.COMPLETED }, USER_ID);

      const { data } = firstCallArg(movementCreateMany) as { data: Record<string, unknown>[] };
      expect(data[0]).toMatchObject({
        productId: PRODUCT_ID,
        type: StockMovementType.REPAIR_OUT,
        quantity: 2,
        referenceType: StockReferenceType.REPAIR,
        referenceId: REPAIR_ID,
        createdById: USER_ID,
      });
    });

    it('stamps the completion time', async () => {
      await service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.COMPLETED }, USER_ID);

      const statusUpdate = executeRaw.mock.calls.map((call) => rawSql(call as unknown[])).find((sql) => sql.includes('SET "status"'));
      expect(statusUpdate).toContain('"completedAt" = NOW()');
    });

    it('moves a job to and from waiting for parts without touching stock', async () => {
      await service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.WAITING_PARTS }, USER_ID);

      expect(movementCreateMany).not.toHaveBeenCalled();
      const touchedInventory = executeRaw.mock.calls.some((call) => rawSql(call as unknown[]).includes('"Inventory"'));
      expect(touchedInventory).toBe(false);
    });

    it('releases the reserved parts when the job is cancelled', async () => {
      await service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.CANCELLED }, USER_ID);

      const released = executeRaw.mock.calls.some((call) => rawSql(call as unknown[]).includes('"reservedQuantity" = "reservedQuantity" - '));
      expect(released).toBe(true);
      expect(movementCreateMany).not.toHaveBeenCalled();
    });

    it('refuses when somebody else moved the repair first', async () => {
      // The conditional UPDATE matched nothing, so the status it checked is
      // no longer the status it would be changing.
      executeRaw.mockResolvedValue(0);

      await expect(service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.COMPLETED }, USER_ID)).rejects.toThrow(/changed by somebody else/);
    });

    it('reports a missing repair as not found', async () => {
      repairFindUnique.mockResolvedValue(null);

      await expect(service.changeStatus(REPAIR_ID, { toStatus: RepairStatus.COMPLETED }, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('parts', () => {
    it('takes the repair lock and asserts it is still open, in one statement', async () => {
      await service.addItem(REPAIR_ID, { productId: PRODUCT_ID, quantity: 1 });

      const sql = rawSql(executeRaw.mock.calls[0] as unknown[]);
      expect(sql).toContain('UPDATE "Repair"');
      expect(sql).toContain('"status" IN');
    });

    it('reserves the part rather than taking it off the shelf', async () => {
      await service.addItem(REPAIR_ID, { productId: PRODUCT_ID, quantity: 3 });

      const reserved = executeRaw.mock.calls.some((call) => rawSql(call as unknown[]).includes('"reservedQuantity" = "reservedQuantity" + '));
      expect(reserved).toBe(true);
      expect(movementCreateMany).not.toHaveBeenCalled();
    });

    it('prices the part from the catalogue when no price is given', async () => {
      await service.addItem(REPAIR_ID, { productId: PRODUCT_ID, quantity: 3 });

      const { data } = firstCallArg(itemCreate) as { data: { unitPrice: Prisma.Decimal; total: Prisma.Decimal } };
      expect(data.unitPrice.toFixed(2)).toBe('30.00');
      expect(data.total.toFixed(2)).toBe('90.00');
    });

    it('honours a price the shop set for this job', async () => {
      await service.addItem(REPAIR_ID, { productId: PRODUCT_ID, quantity: 2, unitPrice: '19.99' });

      const { data } = firstCallArg(itemCreate) as { data: { total: Prisma.Decimal } };
      expect(data.total.toFixed(2)).toBe('39.98');
    });

    it('refuses a part already on the job', async () => {
      itemFindUnique.mockResolvedValue({ id: ITEM_ID });

      await expect(service.addItem(REPAIR_ID, { productId: PRODUCT_ID, quantity: 1 })).rejects.toThrow(/already on this repair/);
    });

    it('refuses a withdrawn product', async () => {
      productFindUnique.mockResolvedValue({ sku: 'PRT-OLD', sellingPrice: decimal('1.00'), isActive: false, deletedAt: null });

      await expect(service.addItem(REPAIR_ID, { productId: PRODUCT_ID, quantity: 1 })).rejects.toThrow(/withdrawn and cannot be fitted/);
    });

    it('refuses to fit parts to a finished repair', async () => {
      executeRaw.mockResolvedValue(0);
      repairFindUnique.mockResolvedValue(repairRow({ status: RepairStatus.DELIVERED }));

      await expect(service.addItem(REPAIR_ID, { productId: PRODUCT_ID, quantity: 1 })).rejects.toThrow(/is DELIVERED and can no longer be changed/);
    });

    it('claims only the difference when the quantity goes up', async () => {
      await service.updateItem(REPAIR_ID, ITEM_ID, { quantity: 5 });

      const reserve = executeRaw.mock.calls.map((call) => call as unknown[]).find((call) => rawSql(call).includes('"reservedQuantity" + '));
      expect(reserve?.[1]).toBe(3);
    });

    it('gives back only the difference when the quantity goes down', async () => {
      await service.updateItem(REPAIR_ID, ITEM_ID, { quantity: 1 });

      const release = executeRaw.mock.calls.map((call) => call as unknown[]).find((call) => rawSql(call).includes('"reservedQuantity" - '));
      expect(release?.[1]).toBe(1);
    });

    it('moves no stock when only the price is corrected', async () => {
      await service.updateItem(REPAIR_ID, ITEM_ID, { unitPrice: '25.00' });

      const touchedInventory = executeRaw.mock.calls.some((call) => rawSql(call as unknown[]).includes('"Inventory"'));
      expect(touchedInventory).toBe(false);

      const { data } = lastCallArg(itemUpdate) as { data: { total: Prisma.Decimal } };
      expect(data.total.toFixed(2)).toBe('50.00');
    });

    it('gives the whole claim back when the part comes off', async () => {
      await service.removeItem(REPAIR_ID, ITEM_ID);

      expect(itemDelete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
      const release = executeRaw.mock.calls.map((call) => call as unknown[]).find((call) => rawSql(call).includes('"reservedQuantity" - '));
      expect(release?.[1]).toBe(2);
    });

    it('refuses to touch a part that belongs to another repair', async () => {
      itemFindUnique.mockResolvedValue({ repairId: 'another', productId: PRODUCT_ID, quantity: 1, unitPrice: decimal('1.00'), product: { sku: 'X' } });

      await expect(service.removeItem(REPAIR_ID, ITEM_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('payments', () => {
    it('locks the repair before adding its payments up', async () => {
      await service.addPayment(REPAIR_ID, { method: PaymentMethod.CASH, amount: '50.00' }, USER_ID);

      const locked = queryRaw.mock.calls.map((call) => rawSql(call as unknown[])).some((sql) => sql.includes('FOR UPDATE'));
      expect(locked).toBe(true);
      expect(paymentAggregate).toHaveBeenCalled();
    });

    it('files the payment against the repair with its own number', async () => {
      await service.addPayment(REPAIR_ID, { method: PaymentMethod.CARD, amount: '50.00', reference: 'auth-7' }, USER_ID);

      const { data } = firstCallArg(paymentCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({ paymentNumber: 'PAY-00000042', repairId: REPAIR_ID, amount: '50.00', reference: 'auth-7', createdById: USER_ID });
    });

    it('refuses more than is outstanding, counting what has already been taken', async () => {
      paymentAggregate.mockResolvedValue({ _sum: { amount: decimal('100.00') } });

      await expect(service.addPayment(REPAIR_ID, { method: PaymentMethod.CASH, amount: '25.00' }, USER_ID)).rejects.toThrow(
        /25.00 is more than the 20.00 outstanding/,
      );
      expect(paymentCreate).not.toHaveBeenCalled();
    });

    it('refuses payment before the work is finished', async () => {
      queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        strings.join(' ').includes('nextval')
          ? Promise.resolve([{ value: '42' }])
          : Promise.resolve([{ status: RepairStatus.IN_PROGRESS, finalCost: '120.00' }]),
      );

      await expect(service.addPayment(REPAIR_ID, { method: PaymentMethod.CASH, amount: '10.00' }, USER_ID)).rejects.toThrow(
        /is IN_PROGRESS; payment can only be recorded once it is completed and priced/,
      );
    });

    it('reports a missing repair as not found', async () => {
      queryRaw.mockResolvedValue([]);

      await expect(service.addPayment(REPAIR_ID, { method: PaymentMethod.CASH, amount: '10.00' }, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    function capturedWhere(): Prisma.RepairWhereInput {
      return (firstCallArg(repairFindMany) as { where: Prisma.RepairWhereInput }).where;
    }

    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findAll(repairQuery());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns an unfiltered workbench by default', async () => {
      await service.findAll(repairQuery());

      expect(capturedWhere()).toEqual({});
    });

    it('narrows to work still on the bench', async () => {
      await service.findAll(repairQuery({ openOnly: true }));

      const { in: statuses } = capturedWhere().status as { in: RepairStatus[] };
      expect(statuses).toContain(RepairStatus.IN_PROGRESS);
      expect(statuses).toContain(RepairStatus.WAITING_PARTS);
      expect(statuses).not.toContain(RepairStatus.DELIVERED);
    });

    it('narrows to jobs whose promised date has gone by', async () => {
      await service.findAll(repairQuery({ overdue: true }));

      const where = capturedWhere();
      const { lt } = where.expectedCompletionAt as { lt: Date };

      expect(lt).toBeInstanceOf(Date);
      // Overdue means late *and* unfinished: a repair delivered last year is
      // not outstanding work.
      expect((where.status as { in: RepairStatus[] }).in).toContain(RepairStatus.IN_PROGRESS);
    });

    it('narrows to jobs nobody has picked up', async () => {
      await service.findAll(repairQuery({ unassigned: true }));

      expect(capturedWhere().technicianId).toBeNull();
    });

    it('lets an explicit technician beat the unassigned shortcut', async () => {
      await service.findAll(repairQuery({ unassigned: true, technicianId: TECHNICIAN_ID }));

      expect(capturedWhere().technicianId).toBe(TECHNICIAN_ID);
    });

    it('lets an explicit status beat the open-only shortcut', async () => {
      await service.findAll(repairQuery({ openOnly: true, status: RepairStatus.DELIVERED }));

      expect(capturedWhere().status).toBe(RepairStatus.DELIVERED);
    });

    it('adds up the parts and the payments on every row', async () => {
      repairFindMany.mockResolvedValue([
        {
          finalCost: decimal('150.00'),
          items: [{ total: decimal('30.00') }, { total: decimal('12.50') }],
          payments: [{ amount: decimal('50.00') }],
        },
      ]);
      repairCount.mockResolvedValue(1);

      const page = await service.findAll(repairQuery());
      const row = page.items[0];

      expect(row?.partsTotal.toFixed(2)).toBe('42.50');
      expect(row?.paidAmount.toFixed(2)).toBe('50.00');
      expect(row?.outstanding?.toFixed(2)).toBe('100.00');
      expect(row?.partsCount).toBe(2);
    });

    it('leaves what is owed unknown until the repair is priced', async () => {
      repairFindMany.mockResolvedValue([{ finalCost: null, items: [{ total: decimal('30.00') }], payments: [] }]);
      repairCount.mockResolvedValue(1);

      const page = await service.findAll(repairQuery());

      expect(page.items[0]?.outstanding).toBeNull();
    });
  });
});
