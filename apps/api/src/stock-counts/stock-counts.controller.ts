import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { CreateStockCountItemDto } from './dto/create-stock-count-item.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { StockCountQueryDto } from './dto/stock-count-query.dto';
import { SubmitCountDto } from './dto/submit-count.dto';
import { UpdateStockCountDto } from './dto/update-stock-count.dto';
import { StockCountsService } from './stock-counts.service';
import type { StockCountDetailView, StockCountSummary } from './stock-count-views';

/**
 * Any authenticated user may read counts and enter a counted quantity -
 * that's the staff walking the floor. Opening, starting, reviewing, approving,
 * completing and cancelling a count are ADMIN/MANAGER, the same management
 * boundary as the rest of the workflow-gated modules: only `approve` touches
 * stock, and it is behind that boundary.
 */
@ApiBearerAuth('access-token')
@ApiTags('Stock Counts')
@Controller('stock-counts')
export class StockCountsController {
  constructor(private readonly stockCountsService: StockCountsService) {}

  @Get()
  @ApiOperation({ summary: 'List stock counts with pagination, search and filters' })
  findAll(@Query() query: StockCountQueryDto): Promise<Paginated<StockCountSummary>> {
    return this.stockCountsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single stock count with its items' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<StockCountDetailView> {
    return this.stockCountsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Open a draft stock count, optionally with its items' })
  create(@Body() dto: CreateStockCountDto, @CurrentUser() caller: AuthenticatedUser): Promise<StockCountDetailView> {
    return this.stockCountsService.create(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: "Update a draft's notes" })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStockCountDto): Promise<StockCountDetailView> {
    return this.stockCountsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/items')
  @ApiOperation({ summary: 'Add one product to a draft count' })
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateStockCountItemDto): Promise<StockCountDetailView> {
    return this.stockCountsService.addItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a product from a draft count' })
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<StockCountDetailView> {
    return this.stockCountsService.removeItem(id, itemId);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start counting' })
  start(@Param('id', ParseUUIDPipe) id: string): Promise<StockCountDetailView> {
    return this.stockCountsService.start(id);
  }

  @Patch(':id/items/:itemId/count')
  @ApiOperation({ summary: 'Record the physical quantity found for one line (a recount simply overwrites the previous value)' })
  submitCount(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SubmitCountDto,
  ): Promise<StockCountDetailView> {
    return this.stockCountsService.submitCount(id, itemId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/submit-for-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close counting and expose variances for review' })
  submitForReview(@Param('id', ParseUUIDPipe) id: string): Promise<StockCountDetailView> {
    return this.stockCountsService.submitForReview(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve the count, applying every non-zero variance to inventory atomically' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<StockCountDetailView> {
    return this.stockCountsService.approve(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close an approved count' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<StockCountDetailView> {
    return this.stockCountsService.complete(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a count before any stock has been adjusted' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<StockCountDetailView> {
    return this.stockCountsService.cancel(id, caller.id);
  }
}
