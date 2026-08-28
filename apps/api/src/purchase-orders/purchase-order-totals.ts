import { Prisma } from '../generated/prisma/client';

/**
 * Money arithmetic for purchase orders. Same style as `order-totals.ts`:
 * exact `Prisma.Decimal` throughout, pure functions, no database client, and
 * a `shipping` amount folded into the total since a supplier's invoice often
 * carries a freight line an Order never has.
 */

export const ZERO = new Prisma.Decimal(0);

export interface LineAmounts {
  quantity: number;
  unitCost: Prisma.Decimal;
  discount: Prisma.Decimal;
}

export interface PurchaseOrderAmounts {
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  shipping: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** What one line comes to: the cost less whatever was taken off that line. */
export function lineTotal(line: LineAmounts): Prisma.Decimal {
  return line.unitCost.mul(line.quantity).sub(line.discount);
}

/** The cost on one line before its discount, used to bound that discount. */
export function lineGross(line: LineAmounts): Prisma.Decimal {
  return line.unitCost.mul(line.quantity);
}

/**
 * Rolls the lines up into the purchase order totals: subtotal from the
 * lines, less the order-wide discount, plus tax and shipping.
 */
export function purchaseOrderTotals(
  lines: readonly LineAmounts[],
  discount: Prisma.Decimal,
  tax: Prisma.Decimal,
  shipping: Prisma.Decimal,
): PurchaseOrderAmounts {
  const subtotal = lines.reduce<Prisma.Decimal>((sum, line) => sum.add(lineTotal(line)), ZERO);

  return { subtotal, discount, tax, shipping, total: subtotal.sub(discount).add(tax).add(shipping) };
}
