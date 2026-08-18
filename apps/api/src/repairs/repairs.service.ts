import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { CreatePaymentDto } from '../common/dto/create-payment.dto';
import { nextDocumentNumber } from '../common/documents/document-number';
import { ErrorCode } from '../common/enums/error-code.enum';
import { consumeStock, releaseStock, reserveStock, type StockLine } from '../common/inventory/stock-operations';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { Prisma, type Payment, type RepairStatusHistory } from '../generated/prisma/client';
import { PaymentReferenceType, RepairStatus, StockMovementType, StockReferenceType, UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { ChangeRepairStatusDto } from './dto/change-repair-status.dto';
import type { CreateRepairItemDto } from './dto/create-repair-item.dto';
import type { CreateRepairDto } from './dto/create-repair.dto';
import type { RepairQueryDto } from './dto/repair-query.dto';
import type { UpdateRepairItemDto } from './dto/update-repair-item.dto';
import type { UpdateRepairDto } from './dto/update-repair.dto';
import { canTransition, nextStatuses, OPEN_REPAIR_STATUSES, PAYABLE_REPAIR_STATUSES } from './repair-status';
import {
  buildRepairWhere,
  REPAIR_DETAIL_INCLUDE,
  REPAIR_SUMMARY_INCLUDE,
  toRepairDetail,
  toRepairSummary,
  type RepairDetail,
  type RepairSummary,
} from './repair-views';

const ZERO = new Prisma.Decimal(0);

/** Who may be handed a device to work on. A salesperson is not a technician. */
const TECHNICIAN_ROLES: readonly UserRole[] = [UserRole.TECHNICIAN, UserRole.ADMIN, UserRole.MANAGER];

/**
 * The repair workflow.
 *
 * A device arrives, is diagnosed, quoted, approved, worked on, finished and
 * handed back - and every one of those steps is recorded in
 * `RepairStatusHistory`, which is the repair's own audit trail: who moved it,
 * from what to what, when, and why.
 *
 * Parts behave the way they do on an order. Adding a part **reserves** stock,
 * so a part promised to a device on the bench cannot be sold from under it;
 * completing the repair **consumes** it and writes the `REPAIR_OUT` movement;
 * cancelling, or taking the part back off, releases the claim. The units stay
 * on the shelf until the repair is finished, which is the only point at which
 * anyone can say for certain that they were used.
 *
 * Every state change is a conditional UPDATE on the repair row, so two people
 * clicking the same button cannot both succeed, and edits take the same lock,
 * so a part cannot be fitted beside a completion already under way.
 */
@Injectable()
export class RepairsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: RepairQueryDto): Promise<Paginated<RepairSummary>> {
    const where = buildRepairWhere(query, new Date());
    const { skip, take } = pageWindow(query.page, query.limit);

    // Both halves in one transaction: counted separately, the page and the
    // total could disagree if a row were inserted between the two queries.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.repair.findMany({ where, include: REPAIR_SUMMARY_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.repair.count({ where }),
    ]);

    return paginate(items.map(toRepairSummary), total, query.page, query.limit);
  }

  async findOne(id: string): Promise<RepairDetail> {
    const repair = await this.prisma.repair.findUnique({ where: { id }, include: REPAIR_DETAIL_INCLUDE });

    if (repair === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Repair not found' });
    }

    return toRepairDetail(repair);
  }

  async findHistory(id: string): Promise<RepairStatusHistory[]> {
    await this.assertExists(id);

    return this.prisma.repairStatusHistory.findMany({
      where: { repairId: id },
      include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findPayments(id: string): Promise<Payment[]> {
    await this.assertExists(id);

    return this.prisma.payment.findMany({ where: { repairId: id }, orderBy: { paidAt: 'asc' } });
  }

  /** Takes a device in, and opens its history with the intake row. */
  async create(dto: CreateRepairDto, userId: string): Promise<RepairDetail> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertCustomerUsable(tx, dto.customerId);
      await assertTechnicianUsable(tx, dto.technicianId);

      const repair = await tx.repair.create({
        data: {
          repairNumber: await nextDocumentNumber(tx, 'REPAIR'),
          customerId: dto.customerId,
          deviceType: dto.deviceType,
          brand: dto.brand ?? null,
          model: dto.model ?? null,
          serialNumber: dto.serialNumber ?? null,
          imei: dto.imei ?? null,
          problemDescription: dto.problemDescription,
          diagnosis: dto.diagnosis ?? null,
          estimatedCost: dto.estimatedCost ?? null,
          technicianId: dto.technicianId ?? null,
          expectedCompletionAt: dto.expectedCompletionAt ?? null,
          notes: dto.notes ?? null,
        },
        select: { id: true },
      });

      // `fromStatus` is null here and only here: the device came from outside
      // the workflow, so there is no status it moved out of.
      await tx.repairStatusHistory.create({
        data: { repairId: repair.id, fromStatus: null, toStatus: RepairStatus.RECEIVED, note: 'Received', changedById: userId },
      });

      return repair.id;
    });

    return this.findOne(id);
  }

  async update(id: string, dto: UpdateRepairDto): Promise<RepairDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockOpenRepair(tx, id);
      await assertCustomerUsable(tx, dto.customerId);
      await assertTechnicianUsable(tx, dto.technicianId);

      await tx.repair.update({
        where: { id },
        data: {
          ...(dto.customerId === undefined ? {} : { customerId: dto.customerId }),
          ...(dto.deviceType === undefined ? {} : { deviceType: dto.deviceType }),
          ...(dto.brand === undefined ? {} : { brand: dto.brand }),
          ...(dto.model === undefined ? {} : { model: dto.model }),
          ...(dto.serialNumber === undefined ? {} : { serialNumber: dto.serialNumber }),
          ...(dto.imei === undefined ? {} : { imei: dto.imei }),
          ...(dto.problemDescription === undefined ? {} : { problemDescription: dto.problemDescription }),
          ...(dto.diagnosis === undefined ? {} : { diagnosis: dto.diagnosis }),
          ...(dto.estimatedCost === undefined ? {} : { estimatedCost: dto.estimatedCost }),
          ...(dto.finalCost === undefined ? {} : { finalCost: dto.finalCost }),
          ...(dto.technicianId === undefined ? {} : { technicianId: dto.technicianId }),
          ...(dto.expectedCompletionAt === undefined ? {} : { expectedCompletionAt: dto.expectedCompletionAt }),
          ...(dto.notes === undefined ? {} : { notes: dto.notes }),
        },
      });
    });

    return this.findOne(id);
  }

  /**
   * Moves the repair along, recording who did it and why.
   *
   * The transition is checked against {@link REPAIR_TRANSITIONS} and then
   * applied with a conditional UPDATE, so a status read a moment ago cannot be
   * acted on after somebody else has moved it.
   */
  async changeStatus(id: string, dto: ChangeRepairStatusDto, userId: string): Promise<RepairDetail> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.repair.findUnique({ where: { id }, select: { status: true, finalCost: true } });

      if (current === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Repair not found' });
      }

      if (!canTransition(current.status, dto.toStatus)) {
        throw new ConflictException({ code: ErrorCode.CONFLICT, message: describeRefusedTransition(current.status, dto.toStatus) });
      }

      // A repair cannot be finished until somebody has said what it costs. The
      // charge is a judgement - labour, diagnosis, goodwill - so it is never
      // inferred from the parts.
      if (dto.toStatus === RepairStatus.COMPLETED && current.finalCost === null) {
        throw new UnprocessableEntityException({
          code: ErrorCode.UNPROCESSABLE_ENTITY,
          message: 'Set the final cost before completing this repair',
        });
      }

      await this.applyStatus(tx, id, current.status, dto.toStatus);

      await tx.repairStatusHistory.create({
        data: { repairId: id, fromStatus: current.status, toStatus: dto.toStatus, note: dto.note ?? null, changedById: userId },
      });

      const parts = await stockLines(tx, id);

      if (dto.toStatus === RepairStatus.COMPLETED) {
        await consumeStock(tx, parts, {
          type: StockMovementType.REPAIR_OUT,
          referenceType: StockReferenceType.REPAIR,
          referenceId: id,
          userId,
        });
      }

      // Nothing was fitted after all, so the claim on those parts is dropped.
      // A cancelled repair can never have been paid: money is only taken once
      // the repair is COMPLETED, and COMPLETED cannot move to CANCELLED.
      if (dto.toStatus === RepairStatus.CANCELLED) {
        await releaseStock(tx, parts);
      }
    });

    return this.findOne(id);
  }

  /** Puts a part on the job and claims it out of sellable stock. */
  async addItem(id: string, dto: CreateRepairItemDto): Promise<RepairDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockOpenRepair(tx, id);

      const product = await loadPart(tx, dto.productId);
      await assertPartNotAlreadyFitted(tx, id, dto.productId, product.sku);

      const unitPrice = dto.unitPrice === undefined ? product.sellingPrice : new Prisma.Decimal(dto.unitPrice);

      await tx.repairItem.create({
        data: { repairId: id, productId: dto.productId, quantity: dto.quantity, unitPrice, total: unitPrice.mul(dto.quantity) },
      });

      await reserveStock(tx, [{ productId: dto.productId, quantity: dto.quantity, sku: product.sku }]);
    });

    return this.findOne(id);
  }

  /**
   * Changes a fitted part.
   *
   * Only the difference in quantity touches stock: asking for two more claims
   * two more, asking for two fewer gives two back, and a price correction
   * moves nothing at all.
   */
  async updateItem(id: string, itemId: string, dto: UpdateRepairItemDto): Promise<RepairDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockOpenRepair(tx, id);

      const item = await findItem(tx, id, itemId);
      const quantity = dto.quantity ?? item.quantity;
      const unitPrice = dto.unitPrice === undefined ? item.unitPrice : new Prisma.Decimal(dto.unitPrice);

      await tx.repairItem.update({ where: { id: itemId }, data: { quantity, unitPrice, total: unitPrice.mul(quantity) } });

      const delta = quantity - item.quantity;
      const line: StockLine = { productId: item.productId, quantity: Math.abs(delta), sku: item.product.sku };

      if (delta > 0) {
        await reserveStock(tx, [line]);
      } else if (delta < 0) {
        await releaseStock(tx, [line]);
      }
    });

    return this.findOne(id);
  }

  async removeItem(id: string, itemId: string): Promise<RepairDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockOpenRepair(tx, id);

      const item = await findItem(tx, id, itemId);

      await tx.repairItem.delete({ where: { id: itemId } });
      await releaseStock(tx, [{ productId: item.productId, quantity: item.quantity, sku: item.product.sku }]);
    });

    return this.findOne(id);
  }

  /**
   * Records money received against a finished repair.
   *
   * A repair has no `paidAmount` column, so what has been collected is the sum
   * of its payments. Taking the repair's row lock first is what makes that sum
   * trustworthy: every writer passes through here, so once the lock is held no
   * other payment can land between the total being read and the new row being
   * written.
   */
  async addPayment(id: string, dto: CreatePaymentDto, userId: string): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const [repair] = await tx.$queryRaw<{ status: RepairStatus; finalCost: string | null }[]>`
        SELECT "status", "finalCost"::text AS "finalCost" FROM "Repair" WHERE "id" = ${id}::uuid FOR UPDATE
      `;

      if (repair === undefined) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Repair not found' });
      }

      if (!PAYABLE_REPAIR_STATUSES.includes(repair.status) || repair.finalCost === null) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `This repair is ${repair.status}; payment can only be recorded once it is completed and priced`,
        });
      }

      const collected = await tx.payment.aggregate({ where: { repairId: id }, _sum: { amount: true } });
      const paidAmount = collected._sum.amount ?? ZERO;
      const amount = new Prisma.Decimal(dto.amount);
      const outstanding = new Prisma.Decimal(repair.finalCost).sub(paidAmount);

      if (amount.gt(outstanding)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `A payment of ${amount.toFixed(2)} is more than the ${outstanding.toFixed(2)} outstanding on this repair`,
        });
      }

      return tx.payment.create({
        data: {
          paymentNumber: await nextDocumentNumber(tx, 'PAYMENT'),
          method: dto.method,
          amount: dto.amount,
          referenceType: PaymentReferenceType.REPAIR,
          repairId: id,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          ...(dto.paidAt === undefined ? {} : { paidAt: dto.paidAt }),
          createdById: userId,
        },
      });
    });
  }

  /** Applies the new status, stamping the completion time when it is earned. */
  private async applyStatus(tx: Prisma.TransactionClient, id: string, from: RepairStatus, to: RepairStatus): Promise<void> {
    const completedAt = to === RepairStatus.COMPLETED ? Prisma.sql`, "completedAt" = NOW()` : Prisma.empty;

    const affected = await tx.$executeRaw`
      UPDATE "Repair"
      SET "status" = ${to}::"RepairStatus", "updatedAt" = NOW()${completedAt}
      WHERE "id" = ${id}::uuid AND "status" = ${from}::"RepairStatus"
    `;

    if (affected === 0) {
      // The status moved between the read and the write, so the transition
      // that was checked is no longer the one being made.
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'This repair was changed by somebody else; reload it and try again',
      });
    }
  }

  private async assertExists(id: string): Promise<void> {
    const repair = await this.prisma.repair.findUnique({ where: { id }, select: { id: true } });

    if (repair === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Repair not found' });
    }
  }
}

/**
 * Takes the repair's row lock and asserts it is still being worked on, in one
 * statement. Everything that edits a repair or its parts starts here, so an
 * edit and a status change can never interleave.
 */
async function lockOpenRepair(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const open = Prisma.join(OPEN_REPAIR_STATUSES.map((status) => Prisma.sql`${status}::"RepairStatus"`));

  const affected = await tx.$executeRaw`
    UPDATE "Repair" SET "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" IN (${open})
  `;

  if (affected === 0) {
    throw await explainClosedRepair(tx, id);
  }
}

async function explainClosedRepair(tx: Prisma.TransactionClient, id: string): Promise<ConflictException | NotFoundException> {
  const repair = await tx.repair.findUnique({ where: { id }, select: { status: true } });

  if (repair === null) {
    return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Repair not found' });
  }

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: `This repair is ${repair.status} and can no longer be changed`,
  });
}

function describeRefusedTransition(from: RepairStatus, to: RepairStatus): string {
  const allowed = nextStatuses(from);

  return allowed.length === 0
    ? `This repair is ${from}, which is final; it cannot become ${to}`
    : `A ${from} repair cannot become ${to}; it can only become ${allowed.join(' or ')}`;
}

async function loadPart(tx: Prisma.TransactionClient, productId: string): Promise<{ sku: string; sellingPrice: Prisma.Decimal }> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { sku: true, sellingPrice: true, isActive: true, deletedAt: true },
  });

  // `undefined !== null` is true, so a missing product throws here too.
  if (product?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
  }

  if (!product.isActive) {
    throw new UnprocessableEntityException({ code: ErrorCode.UNPROCESSABLE_ENTITY, message: `${product.sku} has been withdrawn and cannot be fitted` });
  }

  return { sku: product.sku, sellingPrice: product.sellingPrice };
}

async function assertPartNotAlreadyFitted(tx: Prisma.TransactionClient, repairId: string, productId: string, sku: string): Promise<void> {
  const existing = await tx.repairItem.findUnique({ where: { repairId_productId: { repairId, productId } }, select: { id: true } });

  if (existing !== null) {
    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `${sku} is already on this repair; change the quantity on that line instead`,
    });
  }
}

interface RepairItemForUpdate {
  repairId: string;
  productId: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  product: { sku: string };
}

async function findItem(tx: Prisma.TransactionClient, repairId: string, itemId: string): Promise<RepairItemForUpdate> {
  const item = await tx.repairItem.findUnique({
    where: { id: itemId },
    select: { repairId: true, productId: true, quantity: true, unitPrice: true, product: { select: { sku: true } } },
  });

  // `undefined !== repairId` is true, so a missing item throws here too, and a
  // part on somebody else's repair gets the same answer on purpose.
  if (item?.repairId !== repairId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That part is not on this repair' });
  }

  return item;
}

async function stockLines(tx: Prisma.TransactionClient, repairId: string): Promise<StockLine[]> {
  const items = await tx.repairItem.findMany({
    where: { repairId },
    select: { productId: true, quantity: true, product: { select: { sku: true } } },
  });

  return items.map((item) => ({ productId: item.productId, quantity: item.quantity, sku: item.product.sku }));
}

async function assertCustomerUsable(tx: Prisma.TransactionClient, customerId: string | undefined): Promise<void> {
  if (customerId === undefined) {
    return;
  }

  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { deletedAt: true } });

  if (customer?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Customer not found' });
  }
}

/**
 * A repair can only be handed to somebody who is still here and whose job it
 * is. Assigning work to a deactivated account, or to a salesperson, leaves a
 * job nobody is actually looking at.
 */
async function assertTechnicianUsable(tx: Prisma.TransactionClient, technicianId: string | undefined): Promise<void> {
  if (technicianId === undefined) {
    return;
  }

  const technician = await tx.user.findUnique({ where: { id: technicianId }, select: { role: true, status: true } });

  if (technician === null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Technician not found' });
  }

  if (technician.status !== UserStatus.ACTIVE || !TECHNICIAN_ROLES.includes(technician.role)) {
    throw new UnprocessableEntityException({
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      message: 'Repairs can only be assigned to an active technician, manager or administrator',
    });
  }
}
