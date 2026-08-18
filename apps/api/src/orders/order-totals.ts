import { Prisma } from '../generated/prisma/client';
import { PaymentStatus } from '../generated/prisma/enums';

/**
 * Money arithmetic for orders.
 *
 * Every value here is a `Prisma.Decimal`, which is exact base-ten arithmetic,
 * not a binary float: `0.1 + 0.2` is `0.3` and stays `0.3`. Nothing in this
 * file converts an amount to a JavaScript `number`, because that conversion is
 * exactly where a cent goes missing.
 *
 * The functions are pure and take no database client, so the rules a receipt
 * depends on can be tested directly.
 */

export const ZERO = new Prisma.Decimal(0);

/** A line as the totals need to see it: everything else about it is irrelevant. */
export interface LineAmounts {
  quantity: number;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
}

export interface OrderAmounts {
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * What one line comes to: the goods less whatever was taken off that line.
 *
 * The caller is responsible for rejecting a discount larger than the goods;
 * this returns the arithmetic, not the policy.
 */
export function lineTotal(line: LineAmounts): Prisma.Decimal {
  return line.unitPrice.mul(line.quantity).sub(line.discount);
}

/** The goods on one line before its discount, used to bound that discount. */
export function lineGross(line: LineAmounts): Prisma.Decimal {
  return line.unitPrice.mul(line.quantity);
}

/**
 * Rolls the lines up into the order totals.
 *
 * `subtotal` is the sum of the lines, each already net of its own discount.
 * `discount` is the separate, order-wide reduction - a goodwill gesture on the
 * sale as a whole rather than on any one product. `tax` is an amount rather
 * than a rate because there is nowhere to store a rate; a configurable default
 * belongs with the rest of the settings work.
 */
export function orderTotals(lines: readonly LineAmounts[], discount: Prisma.Decimal, tax: Prisma.Decimal): OrderAmounts {
  const subtotal = lines.reduce<Prisma.Decimal>((sum, line) => sum.add(lineTotal(line)), ZERO);

  return { subtotal, discount, tax, total: subtotal.sub(discount).add(tax) };
}

/**
 * Where an order stands on payment.
 *
 * `REFUNDED` is absent on purpose: money only travels back out through a
 * return, so that state is set by the returns workflow and never inferred from
 * the amounts here.
 */
export function paymentStatusFor(paidAmount: Prisma.Decimal, total: Prisma.Decimal): PaymentStatus {
  if (paidAmount.lte(ZERO)) {
    return PaymentStatus.UNPAID;
  }

  return paidAmount.gte(total) ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
}
