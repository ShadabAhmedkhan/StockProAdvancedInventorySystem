import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService, type DashboardSummary } from './dashboard.service';

@ApiBearerAuth('access-token')
@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'KPIs for the at-a-glance dashboard view' })
  summary(): Promise<DashboardSummary> {
    return this.dashboardService.summary();
  }
}
