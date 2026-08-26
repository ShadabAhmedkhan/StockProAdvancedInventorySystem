import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { databaseConfig } from '../config/database.config';
import { PrismaService } from './prisma.service';
import { TENANT_PRISMA, tenantPrismaProvider } from './tenant-prisma.provider';

/**
 * Global so business modules can inject PrismaService (or the tenant-scoped
 * client under TENANT_PRISMA) without each one re-importing this module.
 * There is exactly one underlying database connection per process either way.
 */
@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [PrismaService, tenantPrismaProvider],
  exports: [PrismaService, TENANT_PRISMA],
})
export class PrismaModule {}
