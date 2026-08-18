const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const UNIT_TO_MS: Readonly<Record<string, number>> = {
  s: MILLISECONDS_PER_SECOND,
  m: MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE,
  h: MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR,
  d: MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY,
};

const DURATION = /^(\d+)([smhd])$/;

/**
 * Converts a JWT-style duration (`30s`, `15m`, `24h`, `7d`) to milliseconds.
 *
 * The environment schema already rejects malformed values, so reaching the
 * throw means a caller passed a literal that was never validated - a
 * programming error worth failing loudly on rather than defaulting.
 */
export function parseDuration(value: string): number {
  const match = DURATION.exec(value);
  const amount = match?.[1];
  const unit = match?.[2];

  if (amount === undefined || unit === undefined) {
    throw new Error(`Invalid duration "${value}": expected a number followed by s, m, h or d`);
  }

  const multiplier = UNIT_TO_MS[unit];
  if (multiplier === undefined) {
    throw new Error(`Invalid duration unit "${unit}"`);
  }

  return Number(amount) * multiplier;
}
