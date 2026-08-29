import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { ReorderQueryDto } from './dto/reorder-query.dto';
import { StockMovementQueryDto } from './dto/stock-movement-query.dto';
import { StockQueryDto } from './dto/stock-query.dto';
import { StockService, type MovementWithContext, type ReorderSuggestion, type StockAdjustmentResult, type StockLevel, type StockSummary } from './stock.service';

/**
 * Everyone may read stock levels - selling, repairing and reordering all need
 * them. Manual movements are restricted to ADMIN and MANAGER: an adjustment is
 * the one place stock can be created or destroyed without a source document,
 * which makes it the control point. Staff move stock through orders, repairs
 * and returns, each of which has a document behind it.
 */
@ApiBearerAuth('access-token')
@ApiTags('Stock')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @ApiOperation({ summary: 'List stock levels, filterable by low or out-of-stock status' })
  findAll(@Query() query: StockQueryDto): Promise<Paginated<StockLevel>> {
    return this.stockService.findAll(query);
  }

  /** Declared before `:productId` so the literal segments are not read as UUIDs. */
  @Get('summary')
  @ApiOperation({ summary: 'Stock counts and valuation, computed in the database' })
  summary(): Promise<StockSummary> {
    return this.stockService.summary();
  }

  @Get('movements')
  @ApiOperation({ summary: 'The stock movement ledger' })
  findMovements(@Query() query: StockMovementQueryDto): Promise<Paginated<MovementWithContext>> {
    return this.stockService.findMovements(query);
  }

  @Get('reorder-suggestions')
  @ApiOperation({ summary: 'Deterministic reorder suggestions for products with a reorder point configured' })
  findReorderSuggestions(@Query() query: ReorderQueryDto): Promise<Paginated<ReorderSuggestion>> {
    return this.stockService.findReorderSuggestions(query);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive or adjust stock, writing the movement in the same transaction' })
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() caller: AuthenticatedUser): Promise<StockAdjustmentResult> {
    return this.stockService.adjust(dto, caller.id);
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Stock level for one product' })
  findOne(@Param('productId', ParseUUIDPipe) productId: string): Promise<StockLevel> {
    return this.stockService.findOne(productId);
  }
}
