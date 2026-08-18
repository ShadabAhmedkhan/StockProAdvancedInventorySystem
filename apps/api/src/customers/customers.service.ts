import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import type { Customer, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { CustomerQueryDto } from './dto/customer-query.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: CustomerQueryDto): Promise<Paginated<Customer>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    // Both halves in one transaction: counted separately, the page and the
    // total could disagree if a row were inserted between the two queries.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.customer.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  /**
   * @param includeDeleted Needed by the restore flow, which by definition has
   * to look at a record that ordinary reads hide.
   */
  async findOne(id: string, includeDeleted = false): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });

    if (customer === null || (!includeDeleted && customer.deletedAt !== null)) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Customer not found' });
    }

    return customer;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    await this.assertCodeAvailable(dto.customerCode);

    return this.prisma.customer.create({
      data: {
        customerCode: dto.customerCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    await this.findOne(id);

    if (dto.customerCode !== undefined) {
      await this.assertCodeAvailable(dto.customerCode, id);
    }

    return this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.customerCode === undefined ? {} : { customerCode: dto.customerCode }),
        ...(dto.firstName === undefined ? {} : { firstName: dto.firstName }),
        ...(dto.lastName === undefined ? {} : { lastName: dto.lastName }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone }),
        ...(dto.email === undefined ? {} : { email: dto.email }),
        ...(dto.address === undefined ? {} : { address: dto.address }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes }),
      },
    });
  }

  /**
   * Soft delete. Customers are referenced by orders, repairs and returns under
   * `ON DELETE RESTRICT`, so removing the row would either fail or destroy the
   * history it belongs to; hiding it keeps every past document readable.
   */
  async remove(id: string): Promise<Customer> {
    await this.findOne(id);

    return this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string): Promise<Customer> {
    const customer = await this.findOne(id, true);

    if (customer.deletedAt === null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'Customer is not deleted' });
    }

    return this.prisma.customer.update({ where: { id }, data: { deletedAt: null } });
  }

  /**
   * The uniqueness check spans deleted rows too, because the unique index does.
   * Saying so is better than letting the caller retry against an invisible row.
   */
  private async assertCodeAvailable(customerCode: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.customer.findUnique({ where: { customerCode }, select: { id: true, deletedAt: true } });

    if (existing === null || existing.id === exceptId) {
      return;
    }

    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message:
        existing.deletedAt === null
          ? 'A customer with this code already exists'
          : 'A deleted customer already uses this code; restore it or choose another code',
    });
  }
}

/** Columns a free-text search looks at. Module-owned, never caller-supplied. */
const SEARCHABLE_FIELDS = ['customerCode', 'firstName', 'lastName', 'phone', 'email'] as const;

function buildWhere(query: CustomerQueryDto): Prisma.CustomerWhereInput {
  const filters: Prisma.CustomerWhereInput = {
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

  const search = searchAcross<Prisma.CustomerWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
