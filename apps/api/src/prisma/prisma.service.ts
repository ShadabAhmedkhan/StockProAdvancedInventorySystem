import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseConfig } from '../config/database.config';
import { PrismaClient } from '../generated/prisma/client';

/**
 * The application's single database client.
 *
 * Extends the generated PrismaClient so every module gets the full, typed API
 * without a wrapper layer to keep in sync. Connection lifecycle is tied to the
 * Nest lifecycle, and `enableShutdownHooks()` in main.ts makes SIGTERM close
 * the pool cleanly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(databaseConfig.KEY) config: ConfigType<typeof databaseConfig>) {
    super({
      adapter: new PrismaPg({ connectionString: config.url }),
      log: config.logLevels,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
