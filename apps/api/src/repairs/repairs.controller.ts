import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePaymentDto } from '../common/dto/create-payment.dto';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import type { Payment, RepairStatusHistory } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { ChangeRepairStatusDto } from './dto/change-repair-status.dto';
import { CreateRepairItemDto } from './dto/create-repair-item.dto';
import { CreateRepairDto } from './dto/create-repair.dto';
import { RepairQueryDto } from './dto/repair-query.dto';
import { UpdateRepairItemDto } from './dto/update-repair-item.dto';
import { UpdateRepairDto } from './dto/update-repair.dto';
import type { RepairDetail, RepairSummary } from './repair-views';
import { RepairsService } from './repairs.service';

/**
 * Who does what.
 *
 * Reading is open to everyone: the counter needs to answer "is it ready yet?"
 * as much as the bench does. Intake and payment belong to the front desk, and
 * diagnosis and parts to the people qualified to fit them. Moving a repair
 * along is open to any signed-in user, because the counter hands devices back
 * and the bench does the work - and every move is recorded in the history with
 * the name of whoever made it.
 */
@ApiBearerAuth('access-token')
@ApiTags('Repairs')
@Controller('repairs')
export class RepairsController {
  constructor(private readonly repairsService: RepairsService) {}

  @Get()
  @ApiOperation({ summary: 'List repairs, filterable by status, technician, overdue and open work' })
  findAll(@Query() query: RepairQueryDto): Promise<Paginated<RepairSummary>> {
    return this.repairsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one repair with its parts, payments and status history' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RepairDetail> {
    return this.repairsService.findOne(id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'The status history of a repair' })
  findHistory(@Param('id', ParseUUIDPipe) id: string): Promise<RepairStatusHistory[]> {
    return this.repairsService.findHistory(id);
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'The payments recorded against a repair' })
  findPayments(@Param('id', ParseUUIDPipe) id: string): Promise<Payment[]> {
    return this.repairsService.findPayments(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post()
  @ApiOperation({ summary: 'Take a device in, opening its status history' })
  create(@Body() dto: CreateRepairDto, @CurrentUser() caller: AuthenticatedUser): Promise<RepairDetail> {
    return this.repairsService.create(dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @Patch(':id')
  @ApiOperation({ summary: 'Update an open repair: diagnosis, costs, technician, promised date' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRepairDto): Promise<RepairDetail> {
    return this.repairsService.update(id, dto);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move the repair along, recording who moved it and why' })
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeRepairStatusDto, @CurrentUser() caller: AuthenticatedUser): Promise<RepairDetail> {
    return this.repairsService.changeStatus(id, dto, caller.id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @Post(':id/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put a part on the job, reserving it out of sellable stock' })
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRepairItemDto): Promise<RepairDetail> {
    return this.repairsService.addItem(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @Patch(':id/items/:itemId')
  @ApiOperation({ summary: 'Change a fitted part, adjusting the reservation by the difference' })
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateRepairItemDto): Promise<RepairDetail> {
    return this.repairsService.updateItem(id, itemId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @Delete(':id/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a part back off the job, releasing its reservation' })
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string): Promise<RepairDetail> {
    return this.repairsService.removeItem(id, itemId);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Post(':id/payments')
  @ApiOperation({ summary: 'Record a payment against a completed repair' })
  addPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePaymentDto, @CurrentUser() caller: AuthenticatedUser): Promise<Payment> {
    return this.repairsService.addPayment(id, dto, caller.id);
  }
}
