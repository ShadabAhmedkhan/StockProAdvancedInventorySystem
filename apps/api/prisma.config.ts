import { resolve } from 'node:path';
import { config as loadEnvFile } from 'dotenv';
import { defineConfig } from 'prisma/config';

// The Prisma CLI runs from apps/api but the environment lives at the monorepo
// root, so both locations are loaded. Values already present in process.env
// always win, which is what CI and container deployments rely on.
loadEnvFile({ path: [resolve(__dirname, '.env'), resolve(__dirname, '../../.env')], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --transpile-only prisma/seed/index.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
