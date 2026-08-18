import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/paginated';
import type { Brand } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { BrandsService } from './brands.service';
import { BrandQueryDto } from './dto/brand-query.dto';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

/** Catalogue structure is management data: anyone may read it, ADMIN and MANAGER shape it. */
@ApiBearerAuth('access-token')
@ApiTags('Brands')
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @ApiOperation({ summary: 'List brands' })
  findAll(@Query() query: BrandQueryDto): Promise<Paginated<Brand>> {
    return this.brandsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single brand' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Brand> {
    return this.brandsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Create a brand; the slug is derived from the name when omitted' })
  create(@Body() dto: CreateBrandDto): Promise<Brand> {
    return this.brandsService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a brand' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto): Promise<Brand> {
    return this.brandsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a brand that no product uses' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<Brand> {
    return this.brandsService.remove(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted brand' })
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<Brand> {
    return this.brandsService.restore(id);
  }
}
