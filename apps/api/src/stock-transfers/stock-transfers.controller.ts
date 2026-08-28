import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { CreateStockTransferItemDto } from './dto/create-stock-transfer-item.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { StockTransferQueryDto } from './dto/stock-transfer-query.dto';
import { UpdateStockTransferItemDto } from './dto/update-stock-transfer-item.dto';
import { UpdateStockTransferDto } from './dto/update-stock-transfer.dto';
import type { StockTransferDetail, StockTransferSummary } from './stock-transfer-views';
import { StockTransfersService } from './stock-transfers.service';

/**
 * Any authenticated user may read a transfer - staff at either location need
 * to see what is coming or going. Writing is limited to ADMIN and MANAGER,
 * the same reasoning as purchase orders: moving stock between locations is an
 * operational concern, not one every role should be able to trigger.
 */
@ApiBearerAuth('access-token')
@ApiTags('Stock Transfers')
@Controller('stock-transfers')
export class StockTransfersController {
  constructor(private readonly stockTransfersService: StockTransfersService) {}

  @Get()
  @ApiOperation({ summary: 'List stock transfers with pagination, search and filters' })
  findAll(@Query() query: StockTransferQueryDto): Promise<Paginated<StockTransferSummary>> {
    return this.stockTransfersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one stock transfer with its items' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<StockTransferDetail> {
    return this.stockTransfersService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Open a draft stock transfer' })
  create(@Body() dto: CreateStockTransferDto, @CurrentUser() caller: AuthenticatedUser): Promise<StockTransferDetail> {
    return this.stockTransfersService.create(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft stock transfer' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStockTransferDto): Promise<StockTransferDetail> {
    return this.stockTransfersService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a line to a draft stock transfer' })
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateStockTransferItemDto): Promise<StockTransferDetail> {
    return this.stockTransfersService.addItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change the quantity on a draft line' })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateStockTransferItemDto,
  ): Promise<StockTransferDetail> {
    return this.stockTransfersService.updateItem(id, itemId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a line from a draft stock transfer' })
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<StockTransferDetail> {
    return this.stockTransfersService.removeItem(id, itemId);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a draft as requested. No inventory effect.' })
  request(@Param('id', ParseUUIDPipe) id: string): Promise<StockTransferDetail> {
    return this.stockTransfersService.request(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a requested transfer, reserving stock at the source location' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<StockTransferDetail> {
    return this.stockTransfersService.approve(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ship an approved transfer, consuming stock at the source location' })
  ship(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<StockTransferDetail> {
    return this.stockTransfersService.ship(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete an in-transit transfer, restoring stock at the destination location' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<StockTransferDetail> {
    return this.stockTransfersService.complete(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a draft, requested or approved stock transfer' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<StockTransferDetail> {
    return this.stockTransfersService.cancel(id, caller.id);
  }
}
