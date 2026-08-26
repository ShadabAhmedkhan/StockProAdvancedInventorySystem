import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { slugify } from '../common/utils/slug.util';
import type { Brand, Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { BrandQueryDto } from './dto/brand-query.dto';
import type { CreateBrandDto } from './dto/create-brand.dto';
import type { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

  async findAll(query: BrandQueryDto): Promise<Paginated<Brand>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.brand.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.brand.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string, includeDeleted = false): Promise<Brand> {
    const brand = await this.prisma.brand.findUnique({ where: { id } });

    if (brand === null || (!includeDeleted && brand.deletedAt !== null)) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Brand not found' });
    }

    return brand;
  }

  async create(dto: CreateBrandDto): Promise<Brand> {
    const slug = this.resolveSlug(dto.slug, dto.name);

    await this.assertNameAvailable(dto.name);
    await this.assertSlugAvailable(slug);

    return this.prisma.brand.create({ data: { organizationId: getCurrentOrgId(), name: dto.name, slug } });
  }

  async update(id: string, dto: UpdateBrandDto): Promise<Brand> {
    await this.findOne(id);

    if (dto.name !== undefined) {
      await this.assertNameAvailable(dto.name, id);
    }
    if (dto.slug !== undefined) {
      await this.assertSlugAvailable(dto.slug, id);
    }

    return this.prisma.brand.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.slug === undefined ? {} : { slug: dto.slug }),
      },
    });
  }

  /**
   * Soft delete, refused while products still use the brand.
   *
   * `Product.brandId` is optional, so the database would allow this - but a
   * live product showing a brand that no list will return is a worse outcome
   * than making the caller reassign the products first.
   */
  async remove(id: string): Promise<Brand> {
    await this.findOne(id);

    const inUse = await this.prisma.product.count({ where: { brandId: id, deletedAt: null } });

    if (inUse > 0) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `This brand is used by ${String(inUse)} product(s). Move or delete them first.`,
      });
    }

    return this.prisma.brand.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string): Promise<Brand> {
    const brand = await this.findOne(id, true);

    if (brand.deletedAt === null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'Brand is not deleted' });
    }

    return this.prisma.brand.update({ where: { id }, data: { deletedAt: null } });
  }

  private resolveSlug(supplied: string | undefined, name: string): string {
    if (supplied !== undefined) {
      return supplied;
    }

    const derived = slugify(name);

    if (derived === '') {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'A slug could not be derived from this name; supply one explicitly',
        errors: [{ field: 'slug', constraints: ['slug is required when it cannot be derived from the name'] }],
      });
    }

    return derived;
  }

  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.brand.findUnique({
      where: { organizationId_name: { organizationId: getCurrentOrgId(), name } },
      select: { id: true, deletedAt: true },
    });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: existing.deletedAt === null ? 'A brand with this name already exists' : 'A deleted brand already uses this name; restore it or choose another',
    });
  }

  private async assertSlugAvailable(slug: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.brand.findUnique({
      where: { organizationId_slug: { organizationId: getCurrentOrgId(), slug } },
      select: { id: true, deletedAt: true },
    });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: existing.deletedAt === null ? 'A brand with this slug already exists' : 'A deleted brand already uses this slug; restore it or choose another',
    });
  }
}

/** Columns a free-text search looks at. Module-owned, never caller-supplied. */
const SEARCHABLE_FIELDS = ['name', 'slug'] as const;

function buildWhere(query: BrandQueryDto): Prisma.BrandWhereInput {
  const filters: Prisma.BrandWhereInput = query.includeDeleted ? {} : { deletedAt: null };
  const search = searchAcross<Prisma.BrandWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
