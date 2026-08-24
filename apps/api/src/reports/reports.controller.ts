import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SalesReportQueryDto } from './dto/sales-report-query.dto';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import { ReportsService, type InventoryReport, type SalesReport, type TopProduct } from './reports.service';

@ApiBearerAuth('access-token')
@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @ApiOperation({ summary: 'Revenue over time, grouped by day, week or month' })
  sales(@Query() query: SalesReportQueryDto): Promise<SalesReport> {
    return this.reportsService.salesReport(query);
  }

  @Get('inventory')
  @ApiOperation({ summary: 'Stock valuation broken down by category' })
  inventory(): Promise<InventoryReport> {
    return this.reportsService.inventoryReport();
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Best-selling products by revenue' })
  topProducts(@Query() query: TopProductsQueryDto): Promise<TopProduct[]> {
    return this.reportsService.topProducts(query);
  }
}
