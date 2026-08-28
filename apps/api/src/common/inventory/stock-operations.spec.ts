import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { StockMovementType, StockReferenceType } from '../../generated/prisma/enums';
import { firstCallArg } from '../testing/mock-args';
import * as tenantContext from '../tenant/tenant-context';
import { consumeStock, releaseStock, reserveStock, restoreStock, type ConsumptionContext, type StockLine } from './stock-operations';

const ORDER_ID = '00000000-0000-4000-8000-00000000000a';
const USER_ID = '00000000-0000-4000-8000-0000000000ff';

/** Two products, deliberately supplied in the reverse of their sorted order. */
const LATER: StockLine = { productId: 'ffffffff-0000-4000-8000-000000000002', quantity: 2, sku: 'SPH-B' };
const EARLIER: StockLine = { productId: '11111111-0000-4000-8000-000000000001', quantity: 3, sku: 'SPH-A' };

interface RawCall {
  sql: string;
  values: unknown[];
}

const SALE_CONTEXT: ConsumptionContext = {
  type: StockMovementType.SALE,
  referenceType: StockReferenceType.ORDER,
  referenceId: ORDER_ID,
  userId: USER_ID,
};

describe('stock operations', () => {
  let executeRaw: jest.Mock;
  let queryRaw: jest.Mock;
  let inventoryFindUnique: jest.Mock;
  let createMany: jest.Mock;
  let locationFindFirstOrThrow: jest.Mock;
  let tx: Prisma.TransactionClient;

  const LOCATION_ID = '99999999-0000-4000-8000-000000000009';

  /** The statements sent, in the order they were sent. */
  function rawCalls(mock: jest.Mock): RawCall[] {
    return mock.mock.calls.map((call) => {
      const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
      return { sql: strings.join(' ').replace(/\s+/g, ' '), values };
    });
  }

  /** The product each statement targeted: the only string among its values. */
  function productOrder(mock: jest.Mock): unknown[] {
    return rawCalls(mock).map((call) => call.values.find((value) => typeof value === 'string'));
  }

  beforeEach(() => {
    jest.spyOn(tenantContext, 'getCurrentOrgId').mockReturnValue('org-1');
    executeRaw = jest.fn(() => Promise.resolve(1));
    queryRaw = jest.fn(() => Promise.resolve([{ quantity: 4 }]));
    inventoryFindUnique = jest.fn(() => Promise.resolve({ quantity: 1, reservedQuantity: 0 }));
    createMany = jest.fn(() => Promise.resolve({ count: 2 }));
    locationFindFirstOrThrow = jest.fn(() => Promise.resolve({ id: LOCATION_ID }));

    tx = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      inventory: { findUnique: inventoryFindUnique },
      stockMovement: { createMany },
      location: { findFirstOrThrow: locationFindFirstOrThrow },
    } as unknown as Prisma.TransactionClient;
  });

  describe('reserveStock', () => {
    it('claims the units each line needs', async () => {
      await reserveStock(tx, [EARLIER]);

      const [call] = rawCalls(executeRaw);
      expect(call?.sql).toContain('"reservedQuantity" = "reservedQuantity" + ');
      expect(call?.values).toEqual([3, EARLIER.productId, 'org-1', LOCATION_ID, 3]);
    });

    it('guards on what is unreserved, not on what is on the shelf', async () => {
      await reserveStock(tx, [EARLIER]);

      // Units already promised to another order are not available to this one.
      expect(rawCalls(executeRaw)[0]?.sql).toContain('"quantity" - "reservedQuantity" >=');
    });

    it('touches products in a fixed order whatever order the lines arrive in', async () => {
      await reserveStock(tx, [LATER, EARLIER]);

      // Two orders holding the same two products must take the row locks in
      // the same sequence, or they deadlock against each other.
      expect(productOrder(executeRaw)).toEqual([EARLIER.productId, LATER.productId]);
    });

    it('rejects the whole reservation when a line cannot be met', async () => {
      executeRaw.mockResolvedValue(0);

      await expect(reserveStock(tx, [EARLIER])).rejects.toThrow(ConflictException);
    });

    it('names the product and the shortfall when it rejects', async () => {
      executeRaw.mockResolvedValue(0);
      inventoryFindUnique.mockResolvedValue({ quantity: 5, reservedQuantity: 4 });

      await expect(reserveStock(tx, [EARLIER])).rejects.toThrow(/SPH-A: 3 required but only 1 available \(5 on hand, 4 reserved\)/);
    });

    it('writes no stock movement, because nothing has actually moved', async () => {
      await reserveStock(tx, [EARLIER, LATER]);

      expect(createMany).not.toHaveBeenCalled();
    });
  });

  describe('consumeStock', () => {
    it('drops the quantity and the reservation together', async () => {
      await consumeStock(tx, [EARLIER], SALE_CONTEXT);

      const [call] = rawCalls(queryRaw);
      expect(call?.sql).toContain('"quantity" = "quantity" - ');
      expect(call?.sql).toContain('"reservedQuantity" = "reservedQuantity" - ');
    });

    it('records the levels the statement itself returned', async () => {
      queryRaw.mockResolvedValue([{ quantity: 4 }]);

      await consumeStock(tx, [EARLIER], SALE_CONTEXT);

      const { data } = firstCallArg(createMany) as { data: Record<string, unknown>[] };
      expect(data[0]).toEqual({
        organizationId: 'org-1',
        productId: EARLIER.productId,
        locationId: LOCATION_ID,
        type: StockMovementType.SALE,
        quantity: 3,
        previousQuantity: 7,
        newQuantity: 4,
        referenceType: StockReferenceType.ORDER,
        referenceId: ORDER_ID,
        createdById: USER_ID,
      });
    });

    it('writes one movement per line, pointing back at the order', async () => {
      await consumeStock(tx, [EARLIER, LATER], SALE_CONTEXT);

      const { data } = firstCallArg(createMany) as { data: { referenceId: string }[] };
      expect(data).toHaveLength(2);
      expect(data.every((movement) => movement.referenceId === ORDER_ID)).toBe(true);
    });

    it('consumes products in the same fixed order as the reservation', async () => {
      await consumeStock(tx, [LATER, EARLIER], SALE_CONTEXT);

      expect(productOrder(queryRaw)).toEqual([EARLIER.productId, LATER.productId]);
    });

    it('refuses, and writes nothing, when the statement matches no row', async () => {
      queryRaw.mockResolvedValue([]);

      await expect(consumeStock(tx, [EARLIER], SALE_CONTEXT)).rejects.toThrow(ConflictException);
      expect(createMany).not.toHaveBeenCalled();
    });
  });

  describe('releaseStock', () => {
    it('gives the claim back without touching the quantity on hand', async () => {
      await releaseStock(tx, [EARLIER]);

      const [call] = rawCalls(executeRaw);
      expect(call?.sql).toContain('"reservedQuantity" = "reservedQuantity" - ');
      expect(call?.sql).not.toContain('"quantity" = "quantity"');
    });

    it('refuses rather than driving a reservation negative', async () => {
      executeRaw.mockResolvedValue(0);

      await expect(releaseStock(tx, [EARLIER])).rejects.toThrow(/reservation is no longer there/);
    });

    it('releases products in the same fixed order', async () => {
      await releaseStock(tx, [LATER, EARLIER]);

      expect(productOrder(executeRaw)).toEqual([EARLIER.productId, LATER.productId]);
    });
  });

  describe('optional locationId (Phase 33 - Stock Transfers)', () => {
    const OTHER_LOCATION_ID = '88888888-0000-4000-8000-000000000008';

    it('reserveStock: falls back to the default location when omitted', async () => {
      await reserveStock(tx, [EARLIER]);

      expect(locationFindFirstOrThrow).toHaveBeenCalled();
      expect(rawCalls(executeRaw)[0]?.values).toContain(LOCATION_ID);
    });

    it('reserveStock: uses the explicit location and never resolves the default', async () => {
      await reserveStock(tx, [EARLIER], OTHER_LOCATION_ID);

      expect(locationFindFirstOrThrow).not.toHaveBeenCalled();
      expect(rawCalls(executeRaw)[0]?.values).toContain(OTHER_LOCATION_ID);
    });

    it('consumeStock: uses the explicit location for both the guard and the movement row', async () => {
      await consumeStock(tx, [EARLIER], SALE_CONTEXT, OTHER_LOCATION_ID);

      expect(locationFindFirstOrThrow).not.toHaveBeenCalled();
      expect(rawCalls(queryRaw)[0]?.values).toContain(OTHER_LOCATION_ID);
      const { data } = firstCallArg(createMany) as { data: Record<string, unknown>[] };
      expect(data[0]?.locationId).toBe(OTHER_LOCATION_ID);
    });

    it('restoreStock: falls back to the default location when omitted', async () => {
      await restoreStock(tx, [EARLIER], SALE_CONTEXT);

      expect(locationFindFirstOrThrow).toHaveBeenCalled();
    });

    it('restoreStock: uses the explicit location', async () => {
      await restoreStock(tx, [EARLIER], SALE_CONTEXT, OTHER_LOCATION_ID);

      expect(locationFindFirstOrThrow).not.toHaveBeenCalled();
      const { data } = firstCallArg(createMany) as { data: Record<string, unknown>[] };
      expect(data[0]?.locationId).toBe(OTHER_LOCATION_ID);
    });

    it('releaseStock: uses the explicit location', async () => {
      await releaseStock(tx, [EARLIER], OTHER_LOCATION_ID);

      expect(locationFindFirstOrThrow).not.toHaveBeenCalled();
      expect(rawCalls(executeRaw)[0]?.values).toContain(OTHER_LOCATION_ID);
    });
  });
});
