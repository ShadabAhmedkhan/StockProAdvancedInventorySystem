/**
 * Shape of a business identifier such as `CUS-0001` or `SUP-0001`: an
 * upper-case prefix, a hyphen, then the code itself. Codes are chosen by the
 * business, so this validates the format only - uniqueness is enforced by the
 * database.
 */
export const ENTITY_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,7}-[A-Z0-9-]{1,24}$/;

/**
 * Digits with the usual separators. Deliberately permissive: this checks that
 * a value is plausibly a phone number, not that anyone answers it, and an
 * over-strict pattern would reject legitimate international formats.
 */
export const PHONE_PATTERN = /^\+?[\d\s().-]{6,32}$/;

/** URL-safe identifier: lower-case words joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Stock-keeping unit. Upper-cased on input, so the pattern is upper-case only. */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,63}$/;

/**
 * Barcode. Permissive on purpose: EAN and UPC are numeric, but shops also
 * label goods with alphanumeric internal codes, and rejecting those would
 * force staff to work around the system.
 */
export const BARCODE_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

/**
 * A monetary amount as an exact decimal string: non-negative, at most two
 * decimal places, and within the integer range of `Decimal(14, 2)`.
 *
 * Money is validated and stored as a string so it never passes through a
 * JavaScript float. `19.99` as a JSON number is already an approximation by
 * the time any validator sees it; as a string it is exact from the request
 * body to the database column.
 */
export const MONEY_PATTERN = /^\d{1,12}(?:\.\d{1,2})?$/;

/**
 * A monetary amount that has to be an actual amount: the same shape as
 * {@link MONEY_PATTERN}, but every way of writing zero is rejected by the
 * leading negative lookahead.
 *
 * Used where a zero would be meaningless rather than merely unusual - a
 * payment of nothing is not a payment. The database says the same thing with a
 * check constraint; catching it here turns a failed write into a plain
 * validation message naming the field.
 */
export const POSITIVE_MONEY_PATTERN = /^(?!0+(?:\.0{1,2})?$)\d{1,12}(?:\.\d{1,2})?$/;
