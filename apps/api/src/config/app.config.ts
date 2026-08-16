import type { LogLevel } from '@nestjs/common';
import { registerAs } from '@nestjs/config';
import { NodeEnvironment, validateEnv } from './env.validation';

export interface ThrottleConfiguration {
  /** Window length in milliseconds, as required by @nestjs/throttler. */
  readonly ttlMs: number;
  readonly limit: number;
}

export interface AppConfiguration {
  readonly nodeEnv: NodeEnvironment;
  readonly isProduction: boolean;
  readonly port: number;
  readonly corsOrigins: string[];
  readonly swaggerEnabled: boolean;
  readonly logLevels: LogLevel[];
  readonly throttle: ThrottleConfiguration;
}

const PRODUCTION_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log'];
const VERBOSE_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Application configuration, derived from the already-validated environment.
 *
 * `validateEnv` is intentionally called again here rather than reaching for a
 * cached module-level value: it is a pure function, and this keeps the config
 * free of hidden state that tests would have to reset.
 */
export const appConfig = registerAs('app', (): AppConfiguration => {
  const env = validateEnv(process.env);
  const isProduction = env.NODE_ENV === NodeEnvironment.Production;

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.API_PORT,
    corsOrigins: env.WEB_URL.split(',').map((origin) => origin.trim()),
    swaggerEnabled: env.SWAGGER_ENABLED === undefined ? !isProduction : env.SWAGGER_ENABLED === 'true',
    logLevels: isProduction ? PRODUCTION_LOG_LEVELS : VERBOSE_LOG_LEVELS,
    throttle: {
      ttlMs: env.THROTTLE_TTL * MILLISECONDS_PER_SECOND,
      limit: env.THROTTLE_LIMIT,
    },
  };
});
