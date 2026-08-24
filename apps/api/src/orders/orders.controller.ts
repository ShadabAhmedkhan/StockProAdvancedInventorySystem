import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import type { Payment } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { CreateOrderItemDto } from './dto/create-order-item.dto';
import { CreatePaymentDto } from '../common/dto/create-payment.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import type { OrderDetail, OrderSummary } from './order-views';
import { OrdersService } from './orders.service';

/**
 * Any authenticated user may read orders - a technician checking what a
 * customer bought needs them. Selling is limited to the roles that serve
 * customers; technicians are deliberately excluded from writing, since their
 * work goes through repairs.
 */
@ApiBearerAuth('access-token')
@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List orders with pagination, search and filters' })
  findAll(@Query() query: OrderQueryDto): Promise<Paginated<OrderSummary>> {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one order with its items and payments' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDetail> {
    return this.ordersService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post()
  @ApiOperation({ summary: 'Open a draft order' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() caller: AuthenticatedUser): Promise<OrderDetail> {
    return this.ordersService.create(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft order and re-price it' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto): Promise<OrderDetail> {
    return this.ordersService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a line to a draft order' })
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateOrderItemDto): Promise<OrderDetail> {
    return this.ordersService.addItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change the quantity, price or discount on a draft line' })
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateOrderItemDto): Promise<OrderDetail> {
    return this.ordersService.updateItem(id, itemId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a line from a draft order' })
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<OrderDetail> {
    return this.ordersService.removeItem(id, itemId);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a draft, reserving the stock its lines need' })
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDetail> {
    return this.ordersService.confirm(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a confirmed order, deducting stock and writing the movements' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<OrderDetail> {
    return this.ordersService.complete(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a draft or confirmed order, releasing any reservation' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<OrderDetail> {
    return this.ordersService.cancel(id, caller.id);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'List the payments recorded against an order' })
  findPayments(@Param('id', ParseUUIDPipe) id: string): Promise<Payment[]> {
    return this.ordersService.findPayments(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/payments')
  @ApiOperation({ summary: 'Record a payment against an order' })
  addPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePaymentDto, @CurrentUser() caller: AuthenticatedUser): Promise<Payment> {
    return this.ordersService.addPayment(id, dto, caller.id);
  }
}
