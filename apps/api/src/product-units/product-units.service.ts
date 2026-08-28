import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { getDefaultLocationId } from '../common/inventory/stock-operations';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { IMEI_PATTERN } from '../common/validation/patterns';
import type { Prisma, ProductUnit } from '../generated/prisma/client';
import { ProductTrackingType } from '../generated/prisma/enums';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { CreateProductUnitDto } from './dto/create-product-unit.dto';
import type { ProductUnitQueryDto } from './dto/product-unit-query.dto';

const PRODUCT_UNIT_INCLUDE = {
  product: { select: { id: true, sku: true, name: true, trackingType: true } },
  location: { select: { id: true, name: true } },
} as const;

export type ProductUnitWithRelations = Prisma.ProductUnitGetPayload<{ include: typeof PRODUCT_UNIT_INCLUDE }>;

@Injectable()
export class ProductUnitsService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

  async findAll(query: ProductUnitQueryDto): Promise<Paginated<ProductUnitWithRelations>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productUnit.findMany({ where, include: PRODUCT_UNIT_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.productUnit.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  /** Scanner-friendly lookup: a staff member scans a serial/IMEI label and gets the unit plus its product straight back. */
  async findBySerialNumber(serialNumber: string): Promise<ProductUnitWithRelations> {
    const unit = await this.prisma.productUnit.findUnique({
      where: { organizationId_serialNumber: { organizationId: getCurrentOrgId(), serialNumber: serialNumber.trim().toUpperCase() } },
      include: PRODUCT_UNIT_INCLUDE,
    });

    if (unit === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'No unit has this serial number or IMEI' });
    }

    return unit;
  }

  /**
   * Registers one serialised/IMEI unit against a product. Refused for
   * products with `trackingType: NONE` - a product that doesn't track units
   * shouldn't accumulate a unit registry nobody asked for.
   */
  async create(dto: CreateProductUnitDto): Promise<ProductUnitWithRelations> {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId }, select: { deletedAt: true, trackingType: true } });

    if (product?.deletedAt !== null) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        errors: [{ field: 'productId', constraints: ['productId must reference an existing product'] }],
      });
    }
    if (product.trackingType === ProductTrackingType.NONE) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'This product does not track individual units' });
    }
    if (product.trackingType === ProductTrackingType.IMEI && !IMEI_PATTERN.test(dto.serialNumber)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        errors: [{ field: 'serialNumber', constraints: ['serialNumber must be exactly 15 digits for an IMEI-tracked product'] }],
      });
    }

    await this.assertSerialNumberAvailable(dto.serialNumber);

    const locationId = dto.locationId ?? (await getDefaultLocationId(this.prisma));

    return this.prisma.productUnit.create({
      data: { organizationId: getCurrentOrgId(), productId: dto.productId, locationId, serialNumber: dto.serialNumber },
      include: PRODUCT_UNIT_INCLUDE,
    });
  }

  async updateStatus(id: string, status: ProductUnit['status']): Promise<ProductUnitWithRelations> {
    await this.findOne(id);

    return this.prisma.productUnit.update({ where: { id }, data: { status }, include: PRODUCT_UNIT_INCLUDE });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.prisma.productUnit.delete({ where: { id } });
  }

  private async findOne(id: string): Promise<ProductUnit> {
    const unit = await this.prisma.productUnit.findUnique({ where: { id } });

    if (unit === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product unit not found' });
    }

    return unit;
  }

  private async assertSerialNumberAvailable(serialNumber: string): Promise<void> {
    const existing = await this.prisma.productUnit.findUnique({
      where: { organizationId_serialNumber: { organizationId: getCurrentOrgId(), serialNumber } },
      select: { id: true },
    });

    if (existing !== null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'A unit with this serial number or IMEI already exists' });
    }
  }
}

const SEARCHABLE_FIELDS = ['serialNumber'] as const;

function buildWhere(query: ProductUnitQueryDto): Prisma.ProductUnitWhereInput {
  const filters: Prisma.ProductUnitWhereInput = {
    ...(query.productId === undefined ? {} : { productId: query.productId }),
    ...(query.status === undefined ? {} : { status: query.status }),
  };

  const search = searchAcross<Prisma.ProductUnitWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
