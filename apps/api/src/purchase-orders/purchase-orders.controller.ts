import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import type { GoodsReceipt } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { CreatePurchaseOrderItemDto } from './dto/create-purchase-order-item.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import type { PurchaseOrderDetail, PurchaseOrderSummary } from './purchase-order-views';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Any authenticated user may read a purchase order - staff receiving a
 * delivery need to see what was ordered. Writing is limited to ADMIN and
 * MANAGER: procurement spends the organization's money, so it needs the same
 * authority as suppliers (master data), narrower than selling, which is also
 * open to STAFF.
 */
@ApiBearerAuth('access-token')
@ApiTags('Purchase Orders')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List purchase orders with pagination, search and filters' })
  findAll(@Query() query: PurchaseOrderQueryDto): Promise<Paginated<PurchaseOrderSummary>> {
    return this.purchaseOrdersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one purchase order with its items' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Open a draft purchase order' })
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() caller: AuthenticatedUser): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.create(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft purchase order and re-price it' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseOrderDto): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a line to a draft purchase order' })
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePurchaseOrderItemDto): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.addItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change the quantity, cost or discount on a draft line' })
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdatePurchaseOrderItemDto,
  ): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.updateItem(id, itemId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a line from a draft purchase order' })
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.removeItem(id, itemId);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a draft, the sign-off gate before it goes to the supplier' })
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.approve(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an approved purchase order as sent to the supplier' })
  order(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.order(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a draft, approved or ordered purchase order' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<PurchaseOrderDetail> {
    return this.purchaseOrdersService.cancel(id, caller.id);
  }

  @Get(':id/goods-receipts')
  @ApiOperation({ summary: 'List the goods receipts recorded against a purchase order' })
  findGoodsReceipts(@Param('id', ParseUUIDPipe) id: string): Promise<GoodsReceipt[]> {
    return this.purchaseOrdersService.findGoodsReceipts(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/goods-receipts')
  @ApiOperation({ summary: 'Record a delivery against an ordered or partially received purchase order' })
  receiveGoods(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGoodsReceiptDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<GoodsReceipt> {
    return this.purchaseOrdersService.receiveGoods(id, dto, caller.id);
  }
}
