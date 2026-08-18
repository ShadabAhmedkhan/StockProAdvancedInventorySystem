import { Prisma } from '../generated/prisma/client';

/**
 * What to credit when goods come back.
 *
 * The hard part is not the arithmetic but the rounding. A line of three units
 * charged at 50.00 cannot be split into three equal refunds - 16.666... has no
 * two-decimal form - so refunding a third three times over would either give
 * back 50.01 or 49.99. Neither is acceptable: a shop must never pay out more
 * than it took, and a customer must never be short-changed for returning their
 * goods in instalments.
 *
 * The rule here is that **returning the last of a line refunds exactly what is
 * left of it**. Partial returns are proportional and rounded; the final one
 * sweeps up whatever remains, so however a line is broken up, the refunds sum
 * to precisely what was charged.
 *
 * Everything is `Prisma.Decimal` - exact base-ten arithmetic, never a float.
 */

const ZERO = new Prisma.Decimal(0);
const MONEY_PLACES = 2;

/** The order line as it was charged. */
export interface SoldLine {
  quantity: number;
  /** What the customer was charged for the line, net of its own discount. */
  total: Prisma.Decimal;
}

/** What earlier returns have already taken back off the same line. */
export interface ReturnedSoFar {
  quantity: number;
  total: Prisma.Decimal;
}

export interface Refundable {
  /** Units of this line that may still come back. */
  quantity: number;
  /** Money still owed against those units. */
  value: Prisma.Decimal;
}

export const NOTHING_RETURNED: ReturnedSoFar = { quantity: 0, total: ZERO };

/** How much of a line is still open to return. */
export function refundable(sold: SoldLine, already: ReturnedSoFar): Refundable {
  return { quantity: sold.quantity - already.quantity, value: sold.total.sub(already.total) };
}

/**
 * What to refund for `quantity` units of a line.
 *
 * Callers must have checked that `quantity` is within {@link refundable}; this
 * computes the amount, not the policy.
 */
export function refundFor(sold: SoldLine, already: ReturnedSoFar, quantity: number): Prisma.Decimal {
  const remaining = refundable(sold, already);

  // Taking the last of the line hands back exactly what is left of it, which
  // is what makes a sequence of partial refunds add up to the line total.
  if (quantity >= remaining.quantity) {
    return remaining.value;
  }

  return sold.total.mul(quantity).div(sold.quantity).toDecimalPlaces(MONEY_PLACES, Prisma.Decimal.ROUND_HALF_UP);
}

/** Adds line refunds up into the amount credited for the whole return. */
export function totalRefund(amounts: readonly Prisma.Decimal[]): Prisma.Decimal {
  return amounts.reduce<Prisma.Decimal>((sum, amount) => sum.add(amount), ZERO);
}

/**
 * How much of a credit can actually be handed back in money.
 *
 * A shop can only return what it has taken. An order settled in full refunds
 * in full; one that was half paid refunds half and no more, with the rest of
 * the credit standing against goods that were never paid for in the first
 * place. Capping it here is what stops a return paying out money that never
 * arrived.
 */
export function refundableInCash(credit: Prisma.Decimal, collected: Prisma.Decimal, alreadyRefunded: Prisma.Decimal): Prisma.Decimal {
  const available = collected.sub(alreadyRefunded);

  if (available.lte(ZERO)) {
    return ZERO;
  }

  return credit.gt(available) ? available : credit;
}
