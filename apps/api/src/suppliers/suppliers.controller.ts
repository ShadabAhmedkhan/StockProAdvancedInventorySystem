import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/paginated';
import type { Supplier } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

/**
 * Any authenticated user may read a supplier - staff receiving a delivery need
 * the contact details. Writing is limited to ADMIN and MANAGER: unlike
 * customers, who arrive at the counter and are entered by whoever serves them,
 * suppliers are purchasing master data.
 */
@ApiBearerAuth('access-token')
@ApiTags('Suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'List suppliers with pagination, search and filters' })
  findAll(@Query() query: SupplierQueryDto): Promise<Paginated<Supplier>> {
    return this.suppliersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single supplier' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Supplier> {
    return this.suppliersService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Create a supplier' })
  create(@Body() dto: CreateSupplierDto): Promise<Supplier> {
    return this.suppliersService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a supplier' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto): Promise<Supplier> {
    return this.suppliersService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a supplier, keeping the provenance of existing stock readable' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<Supplier> {
    return this.suppliersService.remove(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted supplier' })
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<Supplier> {
    return this.suppliersService.restore(id);
  }
}
