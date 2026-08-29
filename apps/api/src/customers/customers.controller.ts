import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import type { Customer, CustomerAddress, CustomerNote } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import type { OrderSummary } from '../orders/order-views';
import type { RepairSummary } from '../repairs/repair-views';
import {
  CustomersService,
  type CustomerLifetimeValue,
  type CustomerOutstanding,
  type CustomerTimelineEntry,
} from './customers.service';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateCustomerNoteDto } from './dto/create-customer-note.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * Reads are open to any authenticated user - a technician working a repair
 * needs the customer's contact details. Writing is limited to the roles that
 * serve customers, and removal to the roles that answer for it.
 */
@ApiBearerAuth('access-token')
@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers with pagination, search and filters' })
  findAll(@Query() query: CustomerQueryDto): Promise<Paginated<Customer>> {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single customer' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Customer> {
    return this.customersService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post()
  @ApiOperation({ summary: 'Create a customer' })
  create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.customersService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a customer' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto): Promise<Customer> {
    return this.customersService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a customer, keeping their order and repair history readable' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<Customer> {
    return this.customersService.remove(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted customer' })
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<Customer> {
    return this.customersService.restore(id);
  }

  @Get(':id/purchase-history')
  @ApiOperation({ summary: "A customer's past orders" })
  purchaseHistory(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto): Promise<Paginated<OrderSummary>> {
    return this.customersService.purchaseHistory(id, query);
  }

  @Get(':id/repair-history')
  @ApiOperation({ summary: "A customer's past repairs" })
  repairHistory(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationQueryDto): Promise<Paginated<RepairSummary>> {
    return this.customersService.repairHistory(id, query);
  }

  @Get(':id/outstanding')
  @ApiOperation({ summary: 'Open orders and repairs where this customer still owes money' })
  outstanding(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerOutstanding> {
    return this.customersService.outstanding(id);
  }

  @Get(':id/lifetime-value')
  @ApiOperation({ summary: 'Total money collected from this customer, across orders and repairs' })
  lifetimeValue(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerLifetimeValue> {
    return this.customersService.lifetimeValue(id);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Orders, repairs, returns and notes for this customer, merged and sorted by time' })
  timeline(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerTimelineEntry[]> {
    return this.customersService.timeline(id);
  }

  @Get(':id/notes')
  @ApiOperation({ summary: "A customer's notes, newest first" })
  listNotes(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerNote[]> {
    return this.customersService.listNotes(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/notes')
  @ApiOperation({ summary: 'Add a note to a customer' })
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCustomerNoteDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<CustomerNote> {
    return this.customersService.addNote(id, dto, caller.id);
  }

  @Get(':id/addresses')
  @ApiOperation({ summary: "A customer's saved addresses" })
  listAddresses(@Param('id', ParseUUIDPipe) id: string): Promise<CustomerAddress[]> {
    return this.customersService.listAddresses(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/addresses')
  @ApiOperation({ summary: 'Add an address to a customer' })
  addAddress(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCustomerAddressDto): Promise<CustomerAddress> {
    return this.customersService.addAddress(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Patch(':id/addresses/:addressId')
  @ApiOperation({ summary: 'Update one of a customer\'s addresses' })
  updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddress> {
    return this.customersService.updateAddress(id, addressId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Delete(':id/addresses/:addressId')
  @ApiOperation({ summary: 'Remove one of a customer\'s addresses' })
  removeAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ): Promise<CustomerAddress> {
    return this.customersService.removeAddress(id, addressId);
  }
}
