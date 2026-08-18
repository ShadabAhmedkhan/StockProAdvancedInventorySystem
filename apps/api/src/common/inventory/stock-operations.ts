import { ConflictException } from '@nestjs/common';
import { ErrorCode } from '../enums/error-code.enum';
import type { Prisma } from '../../generated/prisma/client';
import type { StockMovementType, StockReferenceType } from '../../generated/prisma/enums';

/**
 * How a document moves stock.
 *
 * Four steps, shared by every workflow that moves stock - a sale, a repair, a
 * return:
 *
 *  - `reserveStock`  the goods are spoken for but still on the shelf.
 *  - `consumeStock`  the goods leave, and the ledger says so.
 *  - `releaseStock`  the claim is dropped, nothing moved.
 *  - `restoreStock`  goods come back, and the ledger says so.
 *
 * Each is a single conditional UPDATE rather than a read in JavaScript
 * followed by a write. Two tills claiming the last unit at the same moment
 * would both pass a JavaScript check and both write; here the second statement
 * blocks on the row lock, re-evaluates its WHERE clause against the value the
 * first one committed, and matches no rows.
 *
 * Only the two steps that change the quantity on hand write a StockMovement.
 * The ledger records what is actually on the shelf, and a reservation does not
 * change that - the units are still there, merely promised to someone.
 */

/** One line as the inventory operations need to see it. */
export interface StockLine {
  productId: string;
  quantity: number;
  /** Carried purely so a rejection can name the product the user recognises. */
  sku: string;
}

/** What the ledger should say about a movement, and on whose authority. */
export interface ConsumptionContext {
  type: StockMovementType;
  referenceType: StockReferenceType;
  referenceId: string;
  userId: string;
}

/**
 * Claims stock for a document that has been committed to.
 *
 * The guard is `quantity - reservedQuantity >= n`: a unit already promised
 * elsewhere cannot be promised again, so two documents committed at the same
 * moment cannot both claim the last one.
 */
export async function reserveStock(tx: Prisma.TransactionClient, lines: readonly StockLine[]): Promise<void> {
  for (const line of inProductOrder(lines)) {
    const affected = await tx.$executeRaw`
      UPDATE "Inventory"
      SET "reservedQuantity" = "reservedQuantity" + ${line.quantity}, "updatedAt" = NOW()
      WHERE "productId" = ${line.productId}::uuid
        AND "quantity" - "reservedQuantity" >= ${line.quantity}
    `;

    if (affected === 0) {
      throw await insufficientStock(tx, line);
    }
  }
}

/**
 * Hands the goods over: on-hand quantity and the reservation fall together.
 *
 * Decrementing both by the same amount is what keeps the
 * `Inventory_reserved_within_quantity` constraint satisfied at every instant.
 * The new quantity comes back from the same statement that wrote it, so the
 * ledger records the levels this document actually saw rather than whatever a
 * separate read might find a moment later.
 */
export async function consumeStock(tx: Prisma.TransactionClient, lines: readonly StockLine[], context: ConsumptionContext): Promise<void> {
  const movements: Prisma.StockMovementCreateManyInput[] = [];

  for (const line of inProductOrder(lines)) {
    const rows = await tx.$queryRaw<{ quantity: number }[]>`
      UPDATE "Inventory"
      SET "quantity" = "quantity" - ${line.quantity},
          "reservedQuantity" = "reservedQuantity" - ${line.quantity},
          "updatedAt" = NOW()
      WHERE "productId" = ${line.productId}::uuid
        AND "quantity" >= ${line.quantity}
        AND "reservedQuantity" >= ${line.quantity}
      RETURNING "quantity"
    `;

    const row = rows[0];

    if (row === undefined) {
      throw await insufficientStock(tx, line);
    }

    movements.push({
      productId: line.productId,
      type: context.type,
      quantity: line.quantity,
      previousQuantity: row.quantity + line.quantity,
      newQuantity: row.quantity,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      createdById: context.userId,
    });
  }

  await tx.stockMovement.createMany({ data: movements });
}

/**
 * Puts goods back on the shelf.
 *
 * Nothing can refuse this: stock going up cannot breach the non-negative or
 * reserved-within-quantity constraints, so there is no guard to fail and no
 * conflict to explain. The row is still updated in one statement rather than
 * read and written, so a simultaneous sale of the same product cannot lose
 * either change.
 */
export async function restoreStock(tx: Prisma.TransactionClient, lines: readonly StockLine[], context: ConsumptionContext): Promise<void> {
  const movements: Prisma.StockMovementCreateManyInput[] = [];

  for (const line of inProductOrder(lines)) {
    const rows = await tx.$queryRaw<{ quantity: number }[]>`
      UPDATE "Inventory"
      SET "quantity" = "quantity" + ${line.quantity}, "updatedAt" = NOW()
      WHERE "productId" = ${line.productId}::uuid
      RETURNING "quantity"
    `;

    const row = rows[0];

    if (row === undefined) {
      // A product with no inventory row cannot have been sold in the first
      // place, so this means the row has been deleted underneath us.
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `Cannot put ${String(line.quantity)} units of ${line.sku} back: it has no inventory record`,
      });
    }

    movements.push({
      productId: line.productId,
      type: context.type,
      quantity: line.quantity,
      previousQuantity: row.quantity - line.quantity,
      newQuantity: row.quantity,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      createdById: context.userId,
    });
  }

  await tx.stockMovement.createMany({ data: movements });
}

/** Gives up a claim, leaving the quantity on hand untouched. */
export async function releaseStock(tx: Prisma.TransactionClient, lines: readonly StockLine[]): Promise<void> {
  for (const line of inProductOrder(lines)) {
    const affected = await tx.$executeRaw`
      UPDATE "Inventory"
      SET "reservedQuantity" = "reservedQuantity" - ${line.quantity}, "updatedAt" = NOW()
      WHERE "productId" = ${line.productId}::uuid
        AND "reservedQuantity" >= ${line.quantity}
    `;

    if (affected === 0) {
      // Only reachable if the reservation this document made has gone missing,
      // which would mean the invariant is already broken; refusing to write is
      // better than silently driving the reservation negative.
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `Cannot release ${String(line.quantity)} reserved units of ${line.sku}: the reservation is no longer there`,
      });
    }
  }
}

/**
 * Always touch inventory rows in the same order, whatever order the lines were
 * entered in. Two documents holding the same two products would otherwise be
 * able to take the two row locks in opposite orders and deadlock.
 *
 * The comparison is plain code-unit ordering rather than `localeCompare`,
 * which follows the runtime's locale: two servers with different locales could
 * disagree about the order, which is precisely the deadlock this prevents.
 */
function inProductOrder(lines: readonly StockLine[]): StockLine[] {
  return [...lines].sort((left, right) => {
    if (left.productId < right.productId) {
      return -1;
    }

    return left.productId > right.productId ? 1 : 0;
  });
}

/** Reached only on the failure path, so the extra read costs nothing normally. */
async function insufficientStock(tx: Prisma.TransactionClient, line: StockLine): Promise<ConflictException> {
  const inventory = await tx.inventory.findUnique({
    where: { productId: line.productId },
    select: { quantity: true, reservedQuantity: true },
  });

  const available = inventory === null ? 0 : inventory.quantity - inventory.reservedQuantity;
  const onHand = inventory?.quantity ?? 0;
  const reserved = inventory?.reservedQuantity ?? 0;

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: `Insufficient stock for ${line.sku}: ${String(line.quantity)} required but only ${String(available)} available (${String(onHand)} on hand, ${String(reserved)} reserved)`,
  });
}
