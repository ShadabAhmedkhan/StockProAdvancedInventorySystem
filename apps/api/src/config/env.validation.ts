import { Type, plainToInstance } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsUrl, Matches, Max, Min, MinLength, validateSync } from 'class-validator';

export enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** Comma-separated list of absolute http(s) origins, e.g. `http://a.test,https://b.test`. */
const ORIGIN_LIST = /^https?:\/\/[^\s,/]+(?::\d{1,5})?(?:,https?:\/\/[^\s,/]+(?::\d{1,5})?)*$/;

/** A token lifetime such as `15m`, `24h` or `7d`. */
const DURATION = /^\d+[smhd]$/;

/**
 * Shortest secret accepted. An HS256 key shorter than the 256-bit digest adds
 * no security over one that length, and a human-typed passphrase below this
 * is guessable.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Every environment variable the API reads, with its type and accepted range.
 *
 * Defaults exist only for values that are safe to default. Secrets and
 * connection strings are declared without a default so the process refuses to
 * boot without them.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT = 4000;

  /**
   * PostgreSQL connection string. Deliberately has no default: booting against
   * an unintended database is worse than refusing to boot.
   */
  @IsUrl(
    { protocols: ['postgres', 'postgresql'], require_tld: false, require_protocol: true },
    { message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string' },
  )
  DATABASE_URL: string;

  /** Signs short-lived access tokens. No default: a fallback secret is a backdoor. */
  @MinLength(MIN_SECRET_LENGTH, { message: `JWT_ACCESS_SECRET must be at least ${String(MIN_SECRET_LENGTH)} characters` })
  JWT_ACCESS_SECRET: string;

  /** Signs long-lived refresh tokens. Must differ from the access secret. */
  @MinLength(MIN_SECRET_LENGTH, { message: `JWT_REFRESH_SECRET must be at least ${String(MIN_SECRET_LENGTH)} characters` })
  JWT_REFRESH_SECRET: string;

  @Matches(DURATION, { message: 'JWT_ACCESS_EXPIRES_IN must look like 15m, 24h or 7d' })
  JWT_ACCESS_EXPIRES_IN = '15m';

  @Matches(DURATION, { message: 'JWT_REFRESH_EXPIRES_IN must look like 15m, 24h or 7d' })
  JWT_REFRESH_EXPIRES_IN = '7d';

  @Matches(ORIGIN_LIST, {
    message: 'WEB_URL must be a comma-separated list of http(s) origins without a trailing slash',
  })
  WEB_URL = 'http://localhost:3000';

  /** Throttle window in seconds. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_TTL = 60;

  /** Requests allowed per window, per client. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 100;

  /** Overrides the default (enabled everywhere except production). */
  @IsOptional()
  @IsIn(['true', 'false'])
  SWAGGER_ENABLED?: string;
}

/**
 * Validates the process environment on startup. Throwing here is intentional:
 * a misconfigured API must fail loudly at boot rather than at the first
 * request that happens to need the missing value.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, { exposeDefaultValues: true });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    forbidUnknownValues: true,
  });

  if (errors.length > 0) {
    const details = errors.map((error) => `  ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  // A cross-field rule class-validator cannot express per property: sharing one
  // secret between token kinds would let a stolen refresh token be presented as
  // an access token, defeating the short access-token lifetime entirely.
  if (validated.JWT_ACCESS_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error('Invalid environment configuration:\n  JWT_REFRESH_SECRET must be different from JWT_ACCESS_SECRET');
  }

  return validated;
}
