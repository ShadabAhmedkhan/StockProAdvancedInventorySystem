import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { PlatformAdminAuthGuard } from '../common/guards/platform-admin-auth.guard';
import { platformAdminConfig } from '../config/platform-admin.config';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [ConfigModule.forFeature(platformAdminConfig), JwtModule.register({}), AuditModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminAuthService, PlatformAdminService, PlatformAdminAuthGuard],
})
export class PlatformAdminModule {}
