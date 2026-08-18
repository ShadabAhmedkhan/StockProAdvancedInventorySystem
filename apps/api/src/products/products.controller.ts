import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService, type ProductWithRelations } from './products.service';

/**
 * Anyone may read the catalogue - selling and repairing both need it. Only
 * ADMIN and MANAGER may change it, because a product record carries the cost
 * and selling price, and pricing is a management decision.
 */
@ApiBearerAuth('access-token')
@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products with pagination, search and filters' })
  findAll(@Query() query: ProductQueryDto): Promise<Paginated<ProductWithRelations>> {
    return this.productsService.findAll(query);
  }

  /** Declared before `:id` so the literal segment is not captured as a UUID. */
  @Get('barcode/:barcode')
  @ApiOperation({ summary: 'Look a product up by barcode, for scanning at the counter' })
  findByBarcode(@Param('barcode') barcode: string): Promise<ProductWithRelations> {
    return this.productsService.findByBarcode(barcode);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single product with its category, brand and stock level' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ProductWithRelations> {
    return this.productsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Create a product together with its inventory record' })
  create(@Body() dto: CreateProductDto): Promise<ProductWithRelations> {
    return this.productsService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a product. Stock levels change through the stock endpoints, not here.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto): Promise<ProductWithRelations> {
    return this.productsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a product that holds no stock' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<ProductWithRelations> {
    return this.productsService.remove(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted product' })
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<ProductWithRelations> {
    return this.productsService.restore(id);
  }
}
