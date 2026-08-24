import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import type { Prisma } from '../generated/prisma/client';
import { AuditAction, AuditEntity } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ProductQueryDto } from './dto/product-query.dto';
import type { UpdateProductDto } from './dto/update-product.dto';

/**
 * Relations returned with every product.
 *
 * Fetched through `include` rather than a follow-up query per row, so a page
 * of products costs a fixed number of queries however long the page is.
 * Inventory travels with the product because a catalogue view that cannot show
 * stock is useless, and fetching it separately is the classic N+1.
 */
const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  inventory: { select: { quantity: true, reservedQuantity: true, updatedAt: true } },
} as const;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: ProductQueryDto): Promise<Paginated<ProductWithRelations>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, include: PRODUCT_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string, includeDeleted = false): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });

    if (product === null || (!includeDeleted && product.deletedAt !== null)) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
    }

    return product;
  }

  /** Barcode lookup, for scanning at the counter. */
  async findByBarcode(barcode: string): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findUnique({ where: { barcode }, include: PRODUCT_INCLUDE });

    if (product?.deletedAt !== null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'No product has this barcode' });
    }

    return product;
  }

  /**
   * Creates the product and its inventory row together.
   *
   * Every product has an inventory row from the moment it exists, so stock
   * operations never have to create one on the fly and can take a row lock
   * straight away. The row starts at zero with **no** stock movement: nothing
   * has moved, and the ledger records movements, not the act of listing a
   * product for sale.
   */
  async create(dto: CreateProductDto, callerId: string): Promise<ProductWithRelations> {
    await this.assertSkuAvailable(dto.sku);
    await this.assertBarcodeAvailable(dto.barcode);
    await this.assertCategoryExists(dto.categoryId);
    await this.assertBrandExists(dto.brandId);

    const created = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          sku: dto.sku,
          barcode: dto.barcode ?? null,
          name: dto.name,
          description: dto.description ?? null,
          categoryId: dto.categoryId,
          brandId: dto.brandId ?? null,
          costPrice: dto.costPrice,
          sellingPrice: dto.sellingPrice,
          minimumStock: dto.minimumStock,
          isActive: dto.isActive,
        },
        select: { id: true },
      });

      await tx.inventory.create({ data: { productId: product.id, quantity: 0 } });

      await this.auditService.record(
        { userId: callerId, action: AuditAction.CREATE, entity: AuditEntity.PRODUCT, entityId: product.id, metadata: { sku: dto.sku, name: dto.name } },
        tx,
      );

      return product;
    });

    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateProductDto, callerId: string): Promise<ProductWithRelations> {
    await this.findOne(id);

    if (dto.sku !== undefined) {
      await this.assertSkuAvailable(dto.sku, id);
    }
    if (dto.barcode !== undefined) {
      await this.assertBarcodeAvailable(dto.barcode, id);
    }
    if (dto.categoryId !== undefined) {
      await this.assertCategoryExists(dto.categoryId);
    }
    if (dto.brandId !== undefined) {
      await this.assertBrandExists(dto.brandId);
    }

    const data = {
      ...(dto.sku === undefined ? {} : { sku: dto.sku }),
      ...(dto.barcode === undefined ? {} : { barcode: dto.barcode }),
      ...(dto.name === undefined ? {} : { name: dto.name }),
      ...(dto.description === undefined ? {} : { description: dto.description }),
      ...(dto.categoryId === undefined ? {} : { categoryId: dto.categoryId }),
      ...(dto.brandId === undefined ? {} : { brandId: dto.brandId }),
      ...(dto.costPrice === undefined ? {} : { costPrice: dto.costPrice }),
      ...(dto.sellingPrice === undefined ? {} : { sellingPrice: dto.sellingPrice }),
      ...(dto.minimumStock === undefined ? {} : { minimumStock: dto.minimumStock }),
      ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
    };

    await this.prisma.product.update({ where: { id }, data });

    await this.auditService.record({
      userId: callerId,
      action: AuditAction.UPDATE,
      entity: AuditEntity.PRODUCT,
      entityId: id,
      metadata: { changed: Object.keys(data) },
    });

    return this.findOne(id);
  }

  /**
   * Soft delete, refused while stock remains on hand.
   *
   * Deleting a product that still has units would strand them: the stock is
   * physically on a shelf but no longer visible to any report, and the ledger
   * would no longer reconcile against the inventory table.
   */
  async remove(id: string, callerId: string): Promise<ProductWithRelations> {
    const product = await this.findOne(id);
    const onHand = product.inventory?.quantity ?? 0;

    if (onHand > 0) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `This product still has ${String(onHand)} unit(s) in stock. Adjust the stock to zero before deleting it.`,
      });
    }

    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditService.record({ userId: callerId, action: AuditAction.DELETE, entity: AuditEntity.PRODUCT, entityId: id, metadata: { sku: product.sku } });

    return this.findOne(id, true);
  }

  async restore(id: string): Promise<ProductWithRelations> {
    const product = await this.findOne(id, true);

    if (product.deletedAt === null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'Product is not deleted' });
    }

    await this.prisma.product.update({ where: { id }, data: { deletedAt: null } });

    return this.findOne(id);
  }

  private async assertSkuAvailable(sku: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { sku }, select: { id: true, deletedAt: true } });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: existing.deletedAt === null ? 'A product with this SKU already exists' : 'A deleted product already uses this SKU; restore it or choose another',
    });
  }

  private async assertBarcodeAvailable(barcode: string | undefined, exceptId?: string): Promise<void> {
    if (barcode === undefined) {
      return;
    }

    const existing = await this.prisma.product.findUnique({ where: { barcode }, select: { id: true, deletedAt: true } });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message:
        existing.deletedAt === null
          ? 'A product with this barcode already exists'
          : 'A deleted product already uses this barcode; restore it or choose another',
    });
  }

  /**
   * Checked here rather than left to the foreign key so the caller gets a
   * pointed 400 naming the field, instead of a generic constraint failure.
   */
  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId }, select: { deletedAt: true } });

    if (category?.deletedAt !== null) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        errors: [{ field: 'categoryId', constraints: ['categoryId must reference an existing category'] }],
      });
    }
  }

  private async assertBrandExists(brandId: string | undefined): Promise<void> {
    if (brandId === undefined) {
      return;
    }

    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { deletedAt: true } });

    if (brand?.deletedAt !== null) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        errors: [{ field: 'brandId', constraints: ['brandId must reference an existing brand'] }],
      });
    }
  }
}

/** Columns a free-text search looks at. Module-owned, never caller-supplied. */
const SEARCHABLE_FIELDS = ['sku', 'barcode', 'name', 'description'] as const;

function buildWhere(query: ProductQueryDto): Prisma.ProductWhereInput {
  const filters: Prisma.ProductWhereInput = {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.brandId === undefined ? {} : { brandId: query.brandId }),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.minPrice === undefined && query.maxPrice === undefined
      ? {}
      : {
          sellingPrice: {
            ...(query.minPrice === undefined ? {} : { gte: query.minPrice }),
            ...(query.maxPrice === undefined ? {} : { lte: query.maxPrice }),
          },
        }),
    ...(query.createdFrom === undefined && query.createdTo === undefined
      ? {}
      : {
          createdAt: {
            ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.ProductWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
