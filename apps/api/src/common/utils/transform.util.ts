import type { TransformFnParams } from 'class-transformer';

/**
 * Normalisers for DTO fields.
 *
 * class-transformer types the incoming value as `any`, so each helper narrows
 * it once here and hands back `unknown`. A value that is not a string is passed
 * through untouched for the validators to reject, rather than being coerced
 * into something that looks valid.
 */

/** Trims surrounding whitespace. */
export function trim({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : (value as unknown);
}

/**
 * Trims and lower-cases. Used for email, so that `Ana@X.test` and
 * `ana@x.test` cannot become two accounts.
 */
export function trimLowercase({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : (value as unknown);
}

/**
 * Coerces the string forms a query parameter arrives in into a real boolean.
 *
 * Anything else is passed through so `@IsBoolean()` rejects it, rather than
 * treating every unrecognised value as `false` and silently ignoring a typo.
 */
export function toBoolean({ value }: TransformFnParams): unknown {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  return value as unknown;
}

/**
 * Trims and upper-cases. Used for business codes, so that `cus-1` and `CUS-1`
 * cannot become two records that the unique index sees as different.
 */
export function trimUppercase({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : (value as unknown);
}

/**
 * Normalises a monetary value to an exact decimal string.
 *
 * A JSON number is accepted for client convenience and converted immediately;
 * a string is preferred and passes through untouched. From this point the
 * amount stays a string until Prisma turns it into a Decimal, so no monetary
 * value is ever the result of floating-point arithmetic.
 */
export function toMoneyString({ value }: TransformFnParams): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : value;
  }

  return typeof value === 'string' ? value.trim() : (value as unknown);
}
