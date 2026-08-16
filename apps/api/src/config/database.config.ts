import { registerAs } from '@nestjs/config';
import { NodeEnvironment, validateEnv } from './env.validation';

/** Prisma log levels, kept as a plain union so config stays framework-neutral. */
export type PrismaLogLevel = 'query' | 'info' | 'warn' | 'error';

export interface DatabaseConfiguration {
  readonly url: string;
  readonly logLevels: PrismaLogLevel[];
}

const PRODUCTION_LOG_LEVELS: PrismaLogLevel[] = ['warn', 'error'];
const DEVELOPMENT_LOG_LEVELS: PrismaLogLevel[] = ['warn', 'error'];
/** Tests stay quiet; a failing assertion is the signal, not the query log. */
const TEST_LOG_LEVELS: PrismaLogLevel[] = ['error'];

function logLevelsFor(nodeEnv: NodeEnvironment): PrismaLogLevel[] {
  switch (nodeEnv) {
    case NodeEnvironment.Production:
      return PRODUCTION_LOG_LEVELS;
    case NodeEnvironment.Test:
      return TEST_LOG_LEVELS;
    case NodeEnvironment.Development:
      return DEVELOPMENT_LOG_LEVELS;
  }
}

export const databaseConfig = registerAs('database', (): DatabaseConfiguration => {
  const env = validateEnv(process.env);

  return {
    url: env.DATABASE_URL,
    logLevels: logLevelsFor(env.NODE_ENV),
  };
});
