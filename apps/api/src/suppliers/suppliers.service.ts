import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import type { Prisma, Supplier } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type { SupplierQueryDto } from './dto/supplier-query.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

  async findAll(query: SupplierQueryDto): Promise<Paginated<Supplier>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    // Both halves in one transaction: counted separately, the page and the
    // total could disagree if a row were inserted between the two queries.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.supplier.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  /**
   * @param includeDeleted Needed by the restore flow, which by definition has
   * to look at a record that ordinary reads hide.
   */
  async findOne(id: string, includeDeleted = false): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });

    if (supplier === null || (!includeDeleted && supplier.deletedAt !== null)) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Supplier not found' });
    }

    return supplier;
  }

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    await this.assertCodeAvailable(dto.supplierCode);

    return this.prisma.supplier.create({
      data: {
        organizationId: getCurrentOrgId(),
        supplierCode: dto.supplierCode,
        name: dto.name,
        contactPerson: dto.contactPerson ?? null,
        phone: dto.phone,
        email: dto.email ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    await this.findOne(id);

    if (dto.supplierCode !== undefined) {
      await this.assertCodeAvailable(dto.supplierCode, id);
    }

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.supplierCode === undefined ? {} : { supplierCode: dto.supplierCode }),
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.contactPerson === undefined ? {} : { contactPerson: dto.contactPerson }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        ...(dto.email === undefined ? {} : { email: dto.email }),
        ...(dto.address === undefined ? {} : { address: dto.address }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
      },
    });
  }

  /**
   * Soft delete, matching customers. A supplier is the provenance of stock
   * already on the shelves, so the record has to stay readable even once the
   * business stops buying from them.
   */
  async remove(id: string): Promise<Supplier> {
    await this.findOne(id);

    return this.prisma.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string): Promise<Supplier> {
    const supplier = await this.findOne(id, true);

    if (supplier.deletedAt === null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'Supplier is not deleted' });
    }

    return this.prisma.supplier.update({ where: { id }, data: { deletedAt: null } });
  }

  /**
   * The uniqueness check spans deleted rows too, because the unique index does.
   * Saying so is better than letting the caller retry against an invisible row.
   */
  private async assertCodeAvailable(supplierCode: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.supplier.findUnique({
      where: { organizationId_supplierCode: { organizationId: getCurrentOrgId(), supplierCode } },
      select: { id: true, deletedAt: true },
    });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message:
        existing.deletedAt === null
          ? 'A supplier with this code already exists'
          : 'A deleted supplier already uses this code; restore it or choose another code',
    });
  }
}

/** Columns a free-text search looks at. Module-owned, never caller-supplied. */
const SEARCHABLE_FIELDS = ['supplierCode', 'name', 'contactPerson', 'phone', 'email'] as const;

function buildWhere(query: SupplierQueryDto): Prisma.SupplierWhereInput {
  const filters: Prisma.SupplierWhereInput = {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.createdFrom === undefined && query.createdTo === undefined
      ? {}
      : {
          createdAt: {
            ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.SupplierWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
