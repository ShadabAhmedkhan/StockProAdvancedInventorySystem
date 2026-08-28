import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { CreateProductUnitDto } from './dto/create-product-unit.dto';
import { ProductUnitQueryDto } from './dto/product-unit-query.dto';
import { UpdateProductUnitStatusDto } from './dto/update-product-unit-status.dto';
import { ProductUnitsService, type ProductUnitWithRelations } from './product-units.service';

/**
 * Any authenticated user may read the unit registry - scanning at the
 * counter or in a repair bay needs it. Only ADMIN and MANAGER may register or
 * remove units, the same write boundary as the product catalogue itself.
 */
@ApiBearerAuth('access-token')
@ApiTags('Product Units')
@Controller('product-units')
export class ProductUnitsController {
  constructor(private readonly productUnitsService: ProductUnitsService) {}

  @Get()
  @ApiOperation({ summary: 'List serialised/IMEI units, filterable by product and status' })
  findAll(@Query() query: ProductUnitQueryDto): Promise<Paginated<ProductUnitWithRelations>> {
    return this.productUnitsService.findAll(query);
  }

  /** Declared before `:id` so the literal segment is not captured as a UUID. */
  @Get('scan/:serialNumber')
  @ApiOperation({ summary: 'Look a unit up by its serial number or IMEI, for scanning' })
  findBySerialNumber(@Param('serialNumber') serialNumber: string): Promise<ProductUnitWithRelations> {
    return this.productUnitsService.findBySerialNumber(serialNumber);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Register a serialised/IMEI unit against a product' })
  create(@Body() dto: CreateProductUnitDto): Promise<ProductUnitWithRelations> {
    return this.productUnitsService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/status')
  @ApiOperation({ summary: 'Change a unit\'s status (e.g. mark it sold, returned or damaged)' })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductUnitStatusDto): Promise<ProductUnitWithRelations> {
    return this.productUnitsService.updateStatus(id, dto.status);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a unit registration, e.g. entered in error' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.productUnitsService.remove(id);
  }
}
