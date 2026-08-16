import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnvFile } from 'dotenv';
import { PrismaClient } from '../../src/generated/prisma/client';

loadEnvFile({ path: [resolve(__dirname, '../../.env'), resolve(__dirname, '../../../../.env')], quiet: true });

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env at the repository root before seeding.');
}

/** Seed-local client. The application's PrismaService is Nest-managed and not reusable here. */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: ['warn', 'error'],
});

/** Fixed base date so seeded reports look the same on every machine. */
export const NOW = new Date();

/** Returns a date `days` before now, at a fixed time of day. */
export function daysAgo(days: number, hour = 12): Date {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date;
}
