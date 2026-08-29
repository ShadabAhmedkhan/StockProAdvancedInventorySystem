import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { Prisma, type Customer, type CustomerAddress, type CustomerNote } from '../generated/prisma/client';
import { OrderStatus, PaymentStatus, RepairStatus } from '../generated/prisma/enums';
import { ORDER_SUMMARY_INCLUDE, withOutstanding, type OrderSummary } from '../orders/order-views';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import { REPAIR_SUMMARY_INCLUDE, toRepairSummary, type RepairSummary } from '../repairs/repair-views';
import type { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import type { CreateCustomerDto } from './dto/create-customer.dto';
import type { CreateCustomerNoteDto } from './dto/create-customer-note.dto';
import type { CustomerQueryDto } from './dto/customer-query.dto';
import type { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import type { UpdateCustomerDto } from './dto/update-customer.dto';

const ZERO = new Prisma.Decimal(0);

/** One entry in a customer's merged activity feed. */
export interface CustomerTimelineEntry {
  type: 'ORDER' | 'REPAIR' | 'RETURN' | 'NOTE';
  id: string;
  timestamp: Date;
  summary: string;
}

export interface CustomerOutstanding {
  orders: OrderSummary[];
  repairs: RepairSummary[];
}

export interface CustomerLifetimeValue {
  orderRevenue: string;
  repairRevenue: string;
  total: string;
}

@Injectable()
export class CustomersService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

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
        organizationId: getCurrentOrgId(),
        customerCode: dto.customerCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email ?? null,
        address: dto.address ?? null,
        notes: dto.notes ?? null,
        tags: dto.tags ?? [],
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
        ...(dto.tags === undefined ? {} : { tags: dto.tags }),
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

  /** Past orders. Reuses the same list shape (and `outstanding`) the orders module itself returns. */
  async purchaseHistory(id: string, query: PaginationQueryDto): Promise<Paginated<OrderSummary>> {
    await this.findOne(id, true);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { customerId: id },
        include: ORDER_SUMMARY_INCLUDE,
        orderBy: { createdAt: query.sortOrder },
        skip,
        take,
      }),
      this.prisma.order.count({ where: { customerId: id } }),
    ]);

    return paginate(items.map(withOutstanding), total, query.page, query.limit);
  }

  /** Past repairs, in the same shape the repairs module lists them in. */
  async repairHistory(id: string, query: PaginationQueryDto): Promise<Paginated<RepairSummary>> {
    await this.findOne(id, true);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.repair.findMany({
        where: { customerId: id },
        include: REPAIR_SUMMARY_INCLUDE,
        orderBy: { receivedAt: query.sortOrder },
        skip,
        take,
      }),
      this.prisma.repair.count({ where: { customerId: id } }),
    ]);

    return paginate(items.map(toRepairSummary), total, query.page, query.limit);
  }

  /** Open orders and repairs where money is still owed by this customer. */
  async outstanding(id: string): Promise<CustomerOutstanding> {
    await this.findOne(id, true);

    const [orders, repairs] = await Promise.all([
      this.prisma.order.findMany({
        where: { customerId: id, status: { not: OrderStatus.CANCELLED }, paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL] } },
        include: ORDER_SUMMARY_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.repair.findMany({
        where: { customerId: id, status: { not: RepairStatus.CANCELLED }, finalCost: { not: null } },
        include: REPAIR_SUMMARY_INCLUDE,
        orderBy: { receivedAt: 'desc' },
      }),
    ]);

    const openRepairs = repairs.map(toRepairSummary).filter((repair) => repair.outstanding?.gt(ZERO) === true);

    return { orders: orders.map(withOutstanding), repairs: openRepairs };
  }

  /**
   * Money actually collected from this customer: paid-in on their orders, plus
   * payments recorded against their repairs (repairs have no `paidAmount`
   * column of their own, so that side is the sum of `Payment` rows).
   */
  async lifetimeValue(id: string): Promise<CustomerLifetimeValue> {
    await this.findOne(id, true);

    const [orderPaid, repairPaid] = await Promise.all([
      this.prisma.order.aggregate({ where: { customerId: id, status: { not: OrderStatus.CANCELLED } }, _sum: { paidAmount: true } }),
      this.prisma.payment.aggregate({ where: { repair: { customerId: id } }, _sum: { amount: true } }),
    ]);

    const orderRevenue = orderPaid._sum.paidAmount ?? ZERO;
    const repairRevenue = repairPaid._sum.amount ?? ZERO;

    return {
      orderRevenue: orderRevenue.toFixed(2),
      repairRevenue: repairRevenue.toFixed(2),
      total: orderRevenue.add(repairRevenue).toFixed(2),
    };
  }

  /** Every order, repair, return and note for this customer, newest first. */
  async timeline(id: string): Promise<CustomerTimelineEntry[]> {
    await this.findOne(id, true);

    const [orders, repairs, returns, notes] = await Promise.all([
      this.prisma.order.findMany({ where: { customerId: id }, select: { id: true, orderNumber: true, total: true, createdAt: true } }),
      this.prisma.repair.findMany({ where: { customerId: id }, select: { id: true, repairNumber: true, problemDescription: true, receivedAt: true } }),
      this.prisma.return.findMany({ where: { customerId: id }, select: { id: true, returnNumber: true, refundAmount: true, createdAt: true } }),
      this.prisma.customerNote.findMany({ where: { customerId: id }, select: { id: true, body: true, createdAt: true } }),
    ]);

    const entries: CustomerTimelineEntry[] = [
      ...orders.map((order) => ({
        type: 'ORDER' as const,
        id: order.id,
        timestamp: order.createdAt,
        summary: `Order ${order.orderNumber} for ${order.total.toFixed(2)}`,
      })),
      ...repairs.map((repair) => ({
        type: 'REPAIR' as const,
        id: repair.id,
        timestamp: repair.receivedAt,
        summary: `Repair ${repair.repairNumber}: ${repair.problemDescription}`,
      })),
      ...returns.map((ret) => ({
        type: 'RETURN' as const,
        id: ret.id,
        timestamp: ret.createdAt,
        summary: `Return ${ret.returnNumber}, refund ${ret.refundAmount.toFixed(2)}`,
      })),
      ...notes.map((note) => ({
        type: 'NOTE' as const,
        id: note.id,
        timestamp: note.createdAt,
        summary: note.body.length > 140 ? `${note.body.slice(0, 140)}...` : note.body,
      })),
    ];

    return entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async listNotes(id: string): Promise<CustomerNote[]> {
    await this.findOne(id, true);
    return this.prisma.customerNote.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' } });
  }

  async addNote(id: string, dto: CreateCustomerNoteDto, authorId: string): Promise<CustomerNote> {
    await this.findOne(id, true);
    return this.prisma.customerNote.create({
      data: { organizationId: getCurrentOrgId(), customerId: id, authorId, body: dto.body },
    });
  }

  async listAddresses(id: string): Promise<CustomerAddress[]> {
    await this.findOne(id, true);
    return this.prisma.customerAddress.findMany({ where: { customerId: id }, orderBy: { createdAt: 'asc' } });
  }

  async addAddress(id: string, dto: CreateCustomerAddressDto): Promise<CustomerAddress> {
    await this.findOne(id, true);

    if (dto.isDefault === true) {
      await this.prisma.customerAddress.updateMany({ where: { customerId: id, isDefault: true }, data: { isDefault: false } });
    }

    return this.prisma.customerAddress.create({
      data: {
        organizationId: getCurrentOrgId(),
        customerId: id,
        label: dto.label,
        line1: dto.line1,
        line2: dto.line2 ?? null,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        country: dto.country,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async updateAddress(id: string, addressId: string, dto: UpdateCustomerAddressDto): Promise<CustomerAddress> {
    await this.findAddress(id, addressId);

    if (dto.isDefault === true) {
      await this.prisma.customerAddress.updateMany({ where: { customerId: id, isDefault: true }, data: { isDefault: false } });
    }

    return this.prisma.customerAddress.update({
      where: { id: addressId },
      data: {
        ...(dto.label === undefined ? {} : { label: dto.label }),
        ...(dto.line1 === undefined ? {} : { line1: dto.line1 }),
        ...(dto.line2 === undefined ? {} : { line2: dto.line2 }),
        ...(dto.city === undefined ? {} : { city: dto.city }),
        ...(dto.state === undefined ? {} : { state: dto.state }),
        ...(dto.postalCode === undefined ? {} : { postalCode: dto.postalCode }),
        ...(dto.country === undefined ? {} : { country: dto.country }),
        ...(dto.isDefault === undefined ? {} : { isDefault: dto.isDefault }),
      },
    });
  }

  async removeAddress(id: string, addressId: string): Promise<CustomerAddress> {
    await this.findAddress(id, addressId);
    return this.prisma.customerAddress.delete({ where: { id: addressId } });
  }

  private async findAddress(customerId: string, addressId: string): Promise<CustomerAddress> {
    await this.findOne(customerId, true);
    const address = await this.prisma.customerAddress.findUnique({ where: { id: addressId } });

    if (address?.customerId !== customerId) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Customer address not found' });
    }

    return address;
  }

  /**
   * The uniqueness check spans deleted rows too, because the unique index does.
   * Saying so is better than letting the caller retry against an invisible row.
   */
  private async assertCodeAvailable(customerCode: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.customer.findUnique({
      where: { organizationId_customerCode: { organizationId: getCurrentOrgId(), customerCode } },
      select: { id: true, deletedAt: true },
    });

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
