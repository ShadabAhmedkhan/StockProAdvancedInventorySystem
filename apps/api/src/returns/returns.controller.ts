import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import type { Payment } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { CompleteReturnDto } from './dto/complete-return.dto';
import { CreateReturnItemDto } from './dto/create-return-item.dto';
import { CreateReturnDto } from './dto/create-return.dto';
import { ReturnQueryDto } from './dto/return-query.dto';
import { UpdateReturnItemDto } from './dto/update-return-item.dto';
import { UpdateReturnDto } from './dto/update-return.dto';
import type { ReturnDetail, ReturnSummary } from './return-views';
import { ReturnsService } from './returns.service';

/**
 * Raising a return is counter work, so staff can do it. Deciding whether the
 * shop takes the goods back, and handing money over, is not: approval,
 * rejection and completion are limited to ADMIN and MANAGER, because that is
 * the point at which stock and cash actually move.
 */
@ApiBearerAuth('access-token')
@ApiTags('Returns')
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'List returns with pagination, search and filters' })
  findAll(@Query() query: ReturnQueryDto): Promise<Paginated<ReturnSummary>> {
    return this.returnsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one return with its lines and refunds' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReturnDetail> {
    return this.returnsService.findOne(id);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'The refunds paid against a return' })
  findPayments(@Param('id', ParseUUIDPipe) id: string): Promise<Payment[]> {
    return this.returnsService.findPayments(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post()
  @ApiOperation({ summary: 'Raise a return against a completed order' })
  create(@Body() dto: CreateReturnDto, @CurrentUser() caller: AuthenticatedUser): Promise<ReturnDetail> {
    return this.returnsService.create(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a pending return' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReturnDto): Promise<ReturnDetail> {
    return this.returnsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a line to a pending return' })
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateReturnItemDto): Promise<ReturnDetail> {
    return this.returnsService.addItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change the quantity or restockability of a pending line' })
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateReturnItemDto): Promise<ReturnDetail> {
    return this.returnsService.updateItem(id, itemId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a line from a pending return' })
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<ReturnDetail> {
    return this.returnsService.removeItem(id, itemId);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agree to take the goods back. Nothing moves yet' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<ReturnDetail> {
    return this.returnsService.approve(id, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline the return, freeing its units for another one' })
  reject(@Param('id', ParseUUIDPipe) id: string): Promise<ReturnDetail> {
    return this.returnsService.reject(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take the goods back into stock and refund the customer' })
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteReturnDto, @CurrentUser() caller: AuthenticatedUser): Promise<ReturnDetail> {
    return this.returnsService.complete(id, dto, caller.id);
  }
}
