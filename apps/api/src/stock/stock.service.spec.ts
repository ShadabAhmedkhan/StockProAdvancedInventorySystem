import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { firstCallArg } from '../common/testing/mock-args';
import type { Prisma } from '../generated/prisma/client';
import { StockMovementType, StockReferenceType } from '../generated/prisma/enums';
import { TENANT_PRISMA } from '../prisma/tenant-prisma.provider';
import * as tenantContext from '../common/tenant/tenant-context';
import type { StockMovementQueryDto } from './dto/stock-movement-query.dto';
import { StockService } from './stock.service';

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';

function movementQuery(overrides: Partial<StockMovementQueryDto> = {}): StockMovementQueryDto {
  return { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc', ...overrides };
}

describe('StockService', () => {
  let service: StockService;
  let productFindUnique: jest.Mock;
  let inventoryFindUnique: jest.Mock;
  let inventoryFindUniqueOrThrow: jest.Mock;
  let movementCreate: jest.Mock;
  let movementFindMany: jest.Mock;
  let movementCount: jest.Mock;
  let executeRaw: jest.Mock;
  let transaction: jest.Mock;
  let locationFindFirstOrThrow: jest.Mock;

  const LOCATION_ID = '99999999-0000-4000-8000-000000000009';

  beforeEach(async () => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    productFindUnique = jest.fn(() => Promise.resolve({ id: PRODUCT_ID, sku: 'SPH-AUR-A12', deletedAt: null }));
    inventoryFindUnique = jest.fn(() => Promise.resolve({ quantity: 10, reservedQuantity: 0 }));
    inventoryFindUniqueOrThrow = jest.fn(() => Promise.resolve({ quantity: 10, reservedQuantity: 0 }));
    movementCreate = jest.fn(() => Promise.resolve({ id: 'movement-1' }));
    movementFindMany = jest.fn(() => Promise.resolve([]));
    movementCount = jest.fn(() => Promise.resolve(0));
    locationFindFirstOrThrow = jest.fn(() => Promise.resolve({ id: LOCATION_ID }));
    // The conditional UPDATE reports how many rows it matched.
    executeRaw = jest.fn(() => Promise.resolve(1));

    const client = {
      // findMany empty: an outbound adjustment's LOW_STOCK/OUT_OF_STOCK check finds no
      // matching product, so these tests don't also need to stub the notification fan-out.
      product: { findUnique: productFindUnique, findMany: jest.fn(() => Promise.resolve([])) },
      inventory: { findUnique: inventoryFindUnique, findUniqueOrThrow: inventoryFindUniqueOrThrow },
      stockMovement: { create: movementCreate, findMany: movementFindMany, count: movementCount },
      location: { findFirstOrThrow: locationFindFirstOrThrow },
      user: { findMany: jest.fn(() => Promise.resolve([])) },
      notification: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      $executeRaw: executeRaw,
    };

    transaction = jest.fn((argument: unknown) =>
      typeof argument === 'function' ? (argument as (tx: typeof client) => Promise<unknown>)(client) : Promise.all(argument as Promise<unknown>[]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: TENANT_PRISMA, useValue: { ...client, $transaction: transaction } },
        { provide: AuditService, useValue: { record: jest.fn(() => Promise.resolve()) } },
      ],
    }).compile();

    service = moduleRef.get(StockService);
  });

  describe('adjust', () => {
    it('adds stock for an inbound movement and records the ledger entry', async () => {
      inventoryFindUniqueOrThrow.mockResolvedValue({ quantity: 15, reservedQuantity: 0 });

      const result = await service.adjust({ productId: PRODUCT_ID, type: StockMovementType.PURCHASE, quantity: 5 }, USER_ID);

      expect(result.previousQuantity).toBe(10);
      expect(result.newQuantity).toBe(15);
      expect(result.availableQuantity).toBe(15);
      expect(result.movementId).toBe('movement-1');
    });

    it('removes stock for an outbound movement', async () => {
      inventoryFindUniqueOrThrow.mockResolvedValue({ quantity: 7, reservedQuantity: 0 });

      const result = await service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_OUT, quantity: 3 }, USER_ID);

      expect(result.previousQuantity).toBe(10);
      expect(result.newQuantity).toBe(7);
    });

    it('writes the quantity change and its movement in one transaction', async () => {
      await service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_IN, quantity: 2 }, USER_ID);

      // Stock must never move without a movement to explain it, so both writes
      // have to be able to roll back together.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(executeRaw).toHaveBeenCalledTimes(1);
      expect(movementCreate).toHaveBeenCalledTimes(1);
    });

    it('never reads the quantity into JavaScript before writing it', async () => {
      await service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_OUT, quantity: 4 }, USER_ID);

      // A read-then-write would let two callers both pass the same check. The
      // only read is the one *after* the conditional update, to report the result.
      const readsBeforeUpdate = inventoryFindUnique.mock.calls.length;
      expect(readsBeforeUpdate).toBe(0);
      expect(executeRaw).toHaveBeenCalledTimes(1);
    });

    it('records the magnitude and the surrounding levels on the movement', async () => {
      inventoryFindUniqueOrThrow.mockResolvedValue({ quantity: 6, reservedQuantity: 1 });

      await service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_OUT, quantity: 4, note: 'Damaged in transit' }, USER_ID);

      const { data } = firstCallArg(movementCreate) as { data: Record<string, unknown> };
      expect(data).toMatchObject({
        productId: PRODUCT_ID,
        type: StockMovementType.ADJUSTMENT_OUT,
        quantity: 4,
        previousQuantity: 10,
        newQuantity: 6,
        referenceType: StockReferenceType.MANUAL,
        note: 'Damaged in transit',
        createdById: USER_ID,
      });
    });

    it.each([
      [StockMovementType.PURCHASE, StockReferenceType.PURCHASE],
      [StockMovementType.ADJUSTMENT_IN, StockReferenceType.MANUAL],
      [StockMovementType.ADJUSTMENT_OUT, StockReferenceType.MANUAL],
    ])('attributes a %s movement to %s', async (type, referenceType) => {
      await service.adjust({ productId: PRODUCT_ID, type, quantity: 1 }, USER_ID);

      const { data } = firstCallArg(movementCreate) as { data: { referenceType: StockReferenceType } };
      expect(data.referenceType).toBe(referenceType);
    });

    it('reports insufficient stock when the conditional update matches nothing', async () => {
      executeRaw.mockResolvedValue(0);
      inventoryFindUnique.mockResolvedValue({ quantity: 2, reservedQuantity: 0 });

      await expect(service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_OUT, quantity: 5 }, USER_ID)).rejects.toThrow(
        /5 requested but only 2 available/,
      );
    });

    it('counts reserved units as unavailable', async () => {
      executeRaw.mockResolvedValue(0);
      inventoryFindUnique.mockResolvedValue({ quantity: 10, reservedQuantity: 8 });

      await expect(service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_OUT, quantity: 5 }, USER_ID)).rejects.toThrow(
        /only 2 available \(10 on hand, 8 reserved\)/,
      );
    });

    it('writes no movement when the adjustment is rejected', async () => {
      executeRaw.mockResolvedValue(0);

      await expect(service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_OUT, quantity: 5 }, USER_ID)).rejects.toThrow(ConflictException);
      expect(movementCreate).not.toHaveBeenCalled();
    });

    it('raises a not-found for a product that does not exist', async () => {
      productFindUnique.mockResolvedValue(null);

      await expect(service.adjust({ productId: PRODUCT_ID, type: StockMovementType.PURCHASE, quantity: 1 }, USER_ID)).rejects.toThrow(NotFoundException);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('raises a not-found for a soft-deleted product', async () => {
      productFindUnique.mockResolvedValue({ id: PRODUCT_ID, sku: 'GONE', deletedAt: new Date() });

      await expect(service.adjust({ productId: PRODUCT_ID, type: StockMovementType.PURCHASE, quantity: 1 }, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('raises a not-found when the product has no inventory row at all', async () => {
      executeRaw.mockResolvedValue(0);
      inventoryFindUnique.mockResolvedValue(null);

      await expect(service.adjust({ productId: PRODUCT_ID, type: StockMovementType.ADJUSTMENT_OUT, quantity: 1 }, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMovements', () => {
    function capturedWhere(): Prisma.StockMovementWhereInput {
      return (firstCallArg(movementFindMany) as { where: Prisma.StockMovementWhereInput }).where;
    }

    it('reads the page and the total in one transaction so they agree', async () => {
      await service.findMovements(movementQuery());

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('returns an unfiltered ledger by default', async () => {
      await service.findMovements(movementQuery());

      expect(capturedWhere()).toEqual({});
    });

    it('filters by product, type, reference and author together', async () => {
      await service.findMovements(
        movementQuery({
          productId: PRODUCT_ID,
          type: StockMovementType.SALE,
          referenceType: StockReferenceType.ORDER,
          createdById: USER_ID,
        }),
      );

      expect(capturedWhere()).toEqual({
        productId: PRODUCT_ID,
        type: StockMovementType.SALE,
        referenceType: StockReferenceType.ORDER,
        createdById: USER_ID,
      });
    });

    it('applies a date range', async () => {
      const createdFrom = new Date('2026-01-01T00:00:00.000Z');
      const createdTo = new Date('2026-02-01T00:00:00.000Z');

      await service.findMovements(movementQuery({ createdFrom, createdTo }));

      expect(capturedWhere().createdAt).toEqual({ gte: createdFrom, lte: createdTo });
    });

    it('loads the product and author with the page rather than per row', async () => {
      await service.findMovements(movementQuery());

      const { include } = firstCallArg(movementFindMany) as { include: Record<string, unknown> };
      expect(Object.keys(include)).toEqual(['product', 'createdBy']);
    });

    it('orders newest first by default', async () => {
      await service.findMovements(movementQuery());

      expect(movementFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
    });
  });
});
