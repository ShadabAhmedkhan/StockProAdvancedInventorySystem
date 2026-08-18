import { Prisma } from '../generated/prisma/client';

/** Every Decimal column in the schema is `Decimal(14, 2)`. */
const MONEY_SCALE = 2;

/**
 * Makes monetary values serialise as fixed two-decimal strings.
 *
 * Prisma's Decimal already serialises to a *string* rather than a JSON number,
 * which is what keeps money exact across the wire - but its default drops
 * trailing zeros, so `429.00` would reach a client as `"429"` while `1.05`
 * arrives as `"1.05"`. Clients would then have to guess whether a value is
 * money and reformat it.
 *
 * Overriding `toJSON` fixes the contract once, for every response, including
 * values nested inside arrays and relations. The alternative - mapping money
 * field by field in every service - is the same decision repeated in a hundred
 * places, one of which will eventually be forgotten.
 *
 * This changes serialisation only. Arithmetic still goes through Decimal, and
 * `toString()` / `toFixed()` are untouched.
 */
export function serialiseDecimalsAsFixedStrings(): void {
  Prisma.Decimal.prototype.toJSON = function toJSON(this: Prisma.Decimal): string {
    return this.toFixed(MONEY_SCALE);
  };
}
