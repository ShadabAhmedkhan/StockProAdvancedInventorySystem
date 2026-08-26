import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { slugify } from '../common/utils/slug.util';
import type { Category, Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { CategoryQueryDto } from './dto/category-query.dto';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

  async findAll(query: CategoryQueryDto): Promise<Paginated<Category>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.category.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string, includeDeleted = false): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { id } });

    if (category === null || (!includeDeleted && category.deletedAt !== null)) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Category not found' });
    }

    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    const slug = this.resolveSlug(dto.slug, dto.name);

    await this.assertNameAvailable(dto.name);
    await this.assertSlugAvailable(slug);

    return this.prisma.category.create({
      data: { organizationId: getCurrentOrgId(), name: dto.name, slug, description: dto.description ?? null },
    });
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.findOne(id);

    if (dto.name !== undefined) {
      await this.assertNameAvailable(dto.name, id);
    }
    if (dto.slug !== undefined) {
      await this.assertSlugAvailable(dto.slug, id);
    }

    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.slug === undefined ? {} : { slug: dto.slug }),
        ...(dto.description === undefined ? {} : { description: dto.description }),
      },
    });
  }

  /**
   * Soft delete, refused while products still use the category.
   *
   * `Product.categoryId` is required and `ON DELETE RESTRICT`, so hiding a
   * category that is still referenced would leave live products pointing at
   * something no list will show - a broken catalogue rather than a tidy one.
   */
  async remove(id: string): Promise<Category> {
    await this.findOne(id);

    const inUse = await this.prisma.product.count({ where: { categoryId: id, deletedAt: null } });

    if (inUse > 0) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `This category is used by ${String(inUse)} product(s). Move or delete them first.`,
      });
    }

    return this.prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string): Promise<Category> {
    const category = await this.findOne(id, true);

    if (category.deletedAt === null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'Category is not deleted' });
    }

    return this.prisma.category.update({ where: { id }, data: { deletedAt: null } });
  }

  /**
   * A name of only punctuation or non-Latin script slugifies to nothing.
   * Refusing is better than storing an empty unique key that the next such
   * name would collide with.
   */
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
    const existing = await this.prisma.category.findUnique({
      where: { organizationId_name: { organizationId: getCurrentOrgId(), name } },
      select: { id: true, deletedAt: true },
    });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message:
        existing.deletedAt === null ? 'A category with this name already exists' : 'A deleted category already uses this name; restore it or choose another',
    });
  }

  private async assertSlugAvailable(slug: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.category.findUnique({
      where: { organizationId_slug: { organizationId: getCurrentOrgId(), slug } },
      select: { id: true, deletedAt: true },
    });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message:
        existing.deletedAt === null ? 'A category with this slug already exists' : 'A deleted category already uses this slug; restore it or choose another',
    });
  }
}

/** Columns a free-text search looks at. Module-owned, never caller-supplied. */
const SEARCHABLE_FIELDS = ['name', 'slug', 'description'] as const;

function buildWhere(query: CategoryQueryDto): Prisma.CategoryWhereInput {
  const filters: Prisma.CategoryWhereInput = query.includeDeleted ? {} : { deletedAt: null };
  const search = searchAcross<Prisma.CategoryWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
