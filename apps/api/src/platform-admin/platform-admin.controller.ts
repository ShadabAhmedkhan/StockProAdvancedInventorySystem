import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { SkipSubscriptionCheck } from '../common/decorators/skip-subscription-check.decorator';
import { CurrentPlatformAdmin } from '../common/decorators/current-platform-admin.decorator';
import { PlatformAdminAuthGuard } from '../common/guards/platform-admin-auth.guard';
import type { AuthenticatedPlatformAdmin } from '../common/interfaces/authenticated-platform-admin.interface';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';
import { PlatformAdminAuthService, type PlatformAdminSession } from './platform-admin-auth.service';
import {
  PlatformAdminService,
  type PlatformOrganizationActivity,
  type PlatformOrganizationSummary,
  type PlatformOrganizationUser,
} from './platform-admin.service';

const ONE_MINUTE_MS = 60_000;
const LOGIN_RATE_LIMIT = { default: { limit: 5, ttl: ONE_MINUTE_MS } };

/**
 * A wholly separate surface from every tenant-facing route: `@Public()` here
 * opts these routes out of the global `JwtAuthGuard` (which knows nothing
 * about `PlatformAdmin` tokens), and `PlatformAdminAuthGuard` is applied
 * locally instead of through the `APP_GUARD` chain. No route in this
 * controller is reachable with a tenant access token, and no tenant route
 * is reachable with a platform-admin one.
 */
@ApiTags('Platform Admin')
@SkipSubscriptionCheck()
@Public()
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly authService: PlatformAdminAuthService,
    private readonly platformAdminService: PlatformAdminService,
  ) {}

  @Throttle(LOGIN_RATE_LIMIT)
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in as the platform operator' })
  login(@Body() dto: PlatformAdminLoginDto): Promise<PlatformAdminSession> {
    return this.authService.login(dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations')
  @ApiOperation({ summary: 'Every tenant organization, with subscription status and user count' })
  listOrganizations(): Promise<PlatformOrganizationSummary[]> {
    return this.platformAdminService.listOrganizations();
  }

  @ApiBearerAuth('access-token')
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations/:id/users')
  @ApiOperation({ summary: "A tenant's users - identity fields only, never business data" })
  listOrganizationUsers(@Param('id') id: string): Promise<PlatformOrganizationUser[]> {
    return this.platformAdminService.listOrganizationUsers(id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(PlatformAdminAuthGuard)
  @Get('organizations/:id/activity')
  @ApiOperation({ summary: "The platform operator's own actions against a tenant, newest first" })
  listOrganizationActivity(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformOrganizationActivity[]> {
    return this.platformAdminService.listOrganizationActivity(id);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/trial')
  @ApiOperation({ summary: "Extend a tenant's trial by a number of days" })
  extendTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendTrialDto,
    @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin,
  ): Promise<PlatformOrganizationSummary> {
    return this.platformAdminService.extendTrial(id, dto.days, admin.email);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/suspend')
  @ApiOperation({ summary: 'Lock a tenant out of the product' })
  suspend(@Param('id') id: string, @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin): Promise<PlatformOrganizationSummary> {
    return this.platformAdminService.suspend(id, admin.email);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(PlatformAdminAuthGuard)
  @Patch('organizations/:id/reactivate')
  @ApiOperation({ summary: 'Restore a suspended tenant' })
  reactivate(@Param('id') id: string, @CurrentPlatformAdmin() admin: AuthenticatedPlatformAdmin): Promise<PlatformOrganizationSummary> {
    return this.platformAdminService.reactivate(id, admin.email);
  }
}
