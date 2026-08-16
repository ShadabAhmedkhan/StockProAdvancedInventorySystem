import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { databaseConfig } from '../config/database.config';
import { PrismaService } from './prisma.service';

/**
 * Global so business modules can inject PrismaService without each one
 * re-importing this module. There is exactly one database client per process.
 */
@Global()
@Module({
  imports: [ConfigModule.forFeature(databaseConfig)],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
