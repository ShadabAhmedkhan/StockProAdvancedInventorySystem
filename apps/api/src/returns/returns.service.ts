import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { nextDocumentNumber } from '../common/documents/document-number';
import { ErrorCode } from '../common/enums/error-code.enum';
import { restoreStock, type StockLine } from '../common/inventory/stock-operations';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { Prisma, type Payment } from '../generated/prisma/client';
import { OrderStatus, PaymentReferenceType, PaymentStatus, ReturnStatus, StockMovementType, StockReferenceType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { CompleteReturnDto } from './dto/complete-return.dto';
import type { CreateReturnItemDto } from './dto/create-return-item.dto';
import type { CreateReturnDto } from './dto/create-return.dto';
import type { ReturnQueryDto } from './dto/return-query.dto';
import type { UpdateReturnItemDto } from './dto/update-return-item.dto';
import type { UpdateReturnDto } from './dto/update-return.dto';
import { NOTHING_RETURNED, refundable, refundableInCash, refundFor, totalRefund, type ReturnedSoFar, type SoldLine } from './return-refunds';
import { canTransition, CLAIMING_RETURN_STATUSES, nextStatuses } from './return-status';
import {
  buildReturnWhere,
  RETURN_DETAIL_INCLUDE,
  RETURN_SUMMARY_INCLUDE,
  toReturnDetail,
  toReturnSummary,
  type ReturnDetail,
  type ReturnSummary,
} from './return-views';

const ZERO = new Prisma.Decimal(0);

/**
 * Sales returns.
 *
 * ```text
 *   PENDING --approve--> APPROVED --complete--> COMPLETED
 *      |
 *      +---reject--> REJECTED
 * ```
 *
 * Goods can only come back from an order that actually went out, and only in
 * the quantities that went out on it. A return is raised at the counter, then
 * somebody who can authorise money approves it, and only on completion does
 * stock come back in and the refund go out - both in one transaction, so a
 * refund can never exist for goods that were not restored, or the reverse.
 *
 * Every claim on an order line is serialised on that order's row, so two
 * returns raised at the same moment cannot both take back the last unit.
 */
@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ReturnQueryDto): Promise<Paginated<ReturnSummary>> {
    const where = buildReturnWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    // Both halves in one transaction: counted separately, the page and the
    // total could disagree if a row were inserted between the two queries.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({ where, include: RETURN_SUMMARY_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.return.count({ where }),
    ]);

    return paginate(items.map(toReturnSummary), total, query.page, query.limit);
  }

  async findOne(id: string): Promise<ReturnDetail> {
    const record = await this.prisma.return.findUnique({ where: { id }, include: RETURN_DETAIL_INCLUDE });

    if (record === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Return not found' });
    }

    return toReturnDetail(record);
  }

  async findPayments(id: string): Promise<Payment[]> {
    await this.findOne(id);

    return this.prisma.payment.findMany({ where: { returnId: id }, orderBy: { paidAt: 'asc' } });
  }

  /** Raises a return against a completed order. */
  async create(dto: CreateReturnDto, userId: string): Promise<ReturnDetail> {
    const id = await this.prisma.$transaction(async (tx) => {
      const order = await lockOrder(tx, dto.orderId);

      if (order.status !== OrderStatus.COMPLETED) {
        throw new UnprocessableEntityException({
          code: ErrorCode.UNPROCESSABLE_ENTITY,
          message: `Order ${order.orderNumber} is ${order.status}; goods can only come back from an order that has been completed`,
        });
      }

      const record = await tx.return.create({
        data: {
          returnNumber: await nextDocumentNumber(tx, 'RETURN'),
          orderId: dto.orderId,
          // Taken from the order rather than the request: a return belongs to
          // whoever the sale belonged to, and a walk-in sale has nobody.
          customerId: order.customerId,
          reason: dto.reason,
          reasonNote: dto.reasonNote ?? null,
          createdById: userId,
        },
        select: { id: true },
      });

      for (const item of dto.items) {
        await insertItem(tx, record.id, dto.orderId, item);
      }

      await recomputeRefund(tx, record.id);

      return record.id;
    });

    return this.findOne(id);
  }

  async update(id: string, dto: UpdateReturnDto): Promise<ReturnDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockPendingReturn(tx, id);

      await tx.return.update({
        where: { id },
        data: {
          ...(dto.reason === undefined ? {} : { reason: dto.reason }),
          ...(dto.reasonNote === undefined ? {} : { reasonNote: dto.reasonNote }),
        },
      });
    });

    return this.findOne(id);
  }

  async addItem(id: string, dto: CreateReturnItemDto): Promise<ReturnDetail> {
    await this.prisma.$transaction(async (tx) => {
      const record = await lockPendingReturn(tx, id);
      await lockOrder(tx, record.orderId);

      await insertItem(tx, id, record.orderId, dto);
      await recomputeRefund(tx, id);
    });

    return this.findOne(id);
  }

  async updateItem(id: string, itemId: string, dto: UpdateReturnItemDto): Promise<ReturnDetail> {
    await this.prisma.$transaction(async (tx) => {
      const record = await lockPendingReturn(tx, id);
      await lockOrder(tx, record.orderId);

      const item = await findItem(tx, id, itemId);
      const quantity = dto.quantity ?? item.quantity;
      const { sold, already } = await lineHistory(tx, item.orderItemId, itemId);

      assertWithinRemainder(sold, already, quantity, item.product.sku);

      await tx.returnItem.update({
        where: { id: itemId },
        data: { quantity, total: refundFor(sold, already, quantity), ...(dto.restock === undefined ? {} : { restock: dto.restock }) },
      });

      await recomputeRefund(tx, id);
    });

    return this.findOne(id);
  }

  async removeItem(id: string, itemId: string): Promise<ReturnDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockPendingReturn(tx, id);
      const item = await findItem(tx, id, itemId);

      const remaining = await tx.returnItem.count({ where: { returnId: id } });

      if (remaining <= 1) {
        throw new UnprocessableEntityException({
          code: ErrorCode.UNPROCESSABLE_ENTITY,
          message: 'A return needs at least one line; reject the return instead of emptying it',
        });
      }

      await tx.returnItem.delete({ where: { id: item.id } });
      await recomputeRefund(tx, id);
    });

    return this.findOne(id);
  }

  /** Agrees to take the goods back. Nothing moves yet. */
  async approve(id: string): Promise<ReturnDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, ReturnStatus.PENDING, ReturnStatus.APPROVED);
    });

    return this.findOne(id);
  }

  /** Declines the return, freeing its units to be claimed by another one. */
  async reject(id: string): Promise<ReturnDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, ReturnStatus.PENDING, ReturnStatus.REJECTED);
    });

    return this.findOne(id);
  }

  /**
   * Takes the goods back in and pays the customer.
   *
   * Restoring stock, writing the movements, recording the refund and marking
   * the order refunded all happen in one transaction: a refund can never exist
   * for goods that were not restored, nor stock reappear without the money
   * that went back with it.
   */
  async complete(id: string, dto: CompleteReturnDto, userId: string): Promise<ReturnDetail> {
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.return.findUnique({ where: { id }, select: { orderId: true } });

      if (record === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Return not found' });
      }

      const order = await lockOrder(tx, record.orderId);
      const credit = await this.transition(tx, id, ReturnStatus.APPROVED, ReturnStatus.COMPLETED);

      // Only sellable goods go back on the shelf. Anything marked unsellable
      // is credited and written off, so the ledger never claims stock that
      // cannot be sold.
      const restockable = await restockableLines(tx, id);

      if (restockable.length > 0) {
        await restoreStock(tx, restockable, {
          type: StockMovementType.RETURN_IN,
          referenceType: StockReferenceType.RETURN,
          referenceId: id,
          userId,
        });
      }

      const alreadyRefunded = await refundedOnOrder(tx, record.orderId);
      const cash = refundableInCash(credit, order.paidAmount, alreadyRefunded);

      // A zero refund is a real outcome - goods returned against an order that
      // was never paid for - and the database rejects a payment of nothing, so
      // there is simply no payment to write.
      if (cash.gt(ZERO)) {
        await tx.payment.create({
          data: {
            paymentNumber: await nextDocumentNumber(tx, 'PAYMENT'),
            method: dto.method,
            amount: cash,
            referenceType: PaymentReferenceType.RETURN,
            returnId: id,
            reference: dto.reference ?? null,
            note: dto.note ?? null,
            createdById: userId,
          },
        });
      }

      // Once everything the customer paid has gone back, the order says so.
      if (order.paidAmount.gt(ZERO) && alreadyRefunded.add(cash).gte(order.paidAmount)) {
        await tx.order.update({ where: { id: record.orderId }, data: { paymentStatus: PaymentStatus.REFUNDED } });
      }
    });

    return this.findOne(id);
  }

  /** Moves the return between states, and reports the credit it stands for. */
  private async transition(tx: Prisma.TransactionClient, id: string, from: ReturnStatus, to: ReturnStatus): Promise<Prisma.Decimal> {
    const completedAt = to === ReturnStatus.COMPLETED ? Prisma.sql`, "completedAt" = NOW()` : Prisma.empty;

    const rows = await tx.$queryRaw<{ refundAmount: string }[]>`
      UPDATE "Return"
      SET "status" = ${to}::"ReturnStatus", "updatedAt" = NOW()${completedAt}
      WHERE "id" = ${id}::uuid AND "status" = ${from}::"ReturnStatus"
      RETURNING "refundAmount"::text AS "refundAmount"
    `;

    const row = rows[0];

    if (row === undefined) {
      throw await explainRejectedTransition(tx, id, from, to);
    }

    return new Prisma.Decimal(row.refundAmount);
  }
}

/**
 * Takes the order's row lock.
 *
 * Every claim on an order line passes through here, so once the lock is held
 * the sums of what has already been returned cannot change underneath us. It
 * is what stops two returns raised at the same instant both taking back the
 * last unit of a line.
 */
async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<LockedOrder> {
  const [order] = await tx.$queryRaw<{ orderNumber: string; status: OrderStatus; customerId: string | null; paidAmount: string }[]>`
    SELECT "orderNumber", "status", "customerId", "paidAmount"::text AS "paidAmount"
    FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE
  `;

  if (order === undefined) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Order not found' });
  }

  return { ...order, paidAmount: new Prisma.Decimal(order.paidAmount) };
}

interface LockedOrder {
  orderNumber: string;
  status: OrderStatus;
  customerId: string | null;
  paidAmount: Prisma.Decimal;
}

/**
 * Takes the return's row lock and asserts it is still pending, in one
 * statement, so a line cannot be changed beside an approval already under way.
 */
async function lockPendingReturn(tx: Prisma.TransactionClient, id: string): Promise<{ orderId: string }> {
  const rows = await tx.$queryRaw<{ orderId: string }[]>`
    UPDATE "Return" SET "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = 'PENDING'::"ReturnStatus"
    RETURNING "orderId"
  `;

  const row = rows[0];

  if (row === undefined) {
    throw await explainRejectedTransition(tx, id, ReturnStatus.PENDING, ReturnStatus.PENDING);
  }

  return row;
}

async function explainRejectedTransition(
  tx: Prisma.TransactionClient,
  id: string,
  from: ReturnStatus,
  to: ReturnStatus,
): Promise<ConflictException | NotFoundException> {
  const record = await tx.return.findUnique({ where: { id }, select: { status: true } });

  if (record === null) {
    return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Return not found' });
  }

  const allowed = nextStatuses(record.status);

  if (allowed.length === 0) {
    return new ConflictException({ code: ErrorCode.CONFLICT, message: `This return is ${record.status}, which is final` });
  }

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: canTransition(record.status, to)
      ? 'This return was changed by somebody else; reload it and try again'
      : `This return is ${record.status}; that action needs it to be ${from}`,
  });
}

/** Adds a line, priced against what the order line was actually charged. */
async function insertItem(tx: Prisma.TransactionClient, returnId: string, orderId: string, dto: CreateReturnItemDto): Promise<void> {
  const orderItem = await tx.orderItem.findUnique({
    where: { id: dto.orderItemId },
    select: { orderId: true, productId: true, quantity: true, unitPrice: true, total: true, product: { select: { sku: true } } },
  });

  // `undefined !== orderId` is true, so a missing line throws here too, and a
  // line from a different order gets the same answer on purpose.
  if (orderItem?.orderId !== orderId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That line is not on the order this return is against' });
  }

  const existing = await tx.returnItem.findUnique({
    where: { returnId_orderItemId: { returnId, orderItemId: dto.orderItemId } },
    select: { id: true },
  });

  if (existing !== null) {
    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `${orderItem.product.sku} is already on this return; change the quantity on that line instead`,
    });
  }

  const { sold, already } = await lineHistory(tx, dto.orderItemId, null);

  assertWithinRemainder(sold, already, dto.quantity, orderItem.product.sku);

  await tx.returnItem.create({
    data: {
      returnId,
      orderItemId: dto.orderItemId,
      productId: orderItem.productId,
      quantity: dto.quantity,
      // The list price is recorded for reference; the refund itself comes from
      // what the line was charged, which is net of any discount on it.
      unitPrice: orderItem.unitPrice,
      total: refundFor(sold, already, dto.quantity),
      restock: dto.restock,
    },
  });
}

/**
 * What an order line was sold for, and what other returns have already taken
 * back off it.
 *
 * Rejected returns are excluded: the shop declined them, so those units were
 * never taken back. `exceptItemId` leaves out the line being edited, so
 * changing a quantity is measured against everything else rather than against
 * itself.
 */
async function lineHistory(
  tx: Prisma.TransactionClient,
  orderItemId: string,
  exceptItemId: string | null,
): Promise<{ sold: SoldLine; already: ReturnedSoFar }> {
  const orderItem = await tx.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, select: { quantity: true, total: true } });

  const claimed = await tx.returnItem.aggregate({
    where: {
      orderItemId,
      returnRecord: { status: { in: [...CLAIMING_RETURN_STATUSES] } },
      ...(exceptItemId === null ? {} : { id: { not: exceptItemId } }),
    },
    _sum: { quantity: true, total: true },
  });

  return {
    sold: { quantity: orderItem.quantity, total: orderItem.total },
    already: { quantity: claimed._sum.quantity ?? 0, total: claimed._sum.total ?? NOTHING_RETURNED.total },
  };
}

function assertWithinRemainder(sold: SoldLine, already: ReturnedSoFar, quantity: number, sku: string): void {
  const remaining = refundable(sold, already);

  if (quantity > remaining.quantity) {
    throw new UnprocessableEntityException({
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      message: `Only ${String(remaining.quantity)} of ${String(sold.quantity)} ${sku} are still open to return; ${String(quantity)} were asked for`,
    });
  }
}

async function findItem(tx: Prisma.TransactionClient, returnId: string, itemId: string): Promise<ReturnItemForUpdate> {
  const item = await tx.returnItem.findUnique({
    where: { id: itemId },
    select: { id: true, returnId: true, orderItemId: true, quantity: true, product: { select: { sku: true } } },
  });

  if (item?.returnId !== returnId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That line is not on this return' });
  }

  return item;
}

interface ReturnItemForUpdate {
  id: string;
  returnId: string;
  orderItemId: string;
  quantity: number;
  product: { sku: string };
}

/** Keeps the stored credit equal to the sum of the lines it is made of. */
async function recomputeRefund(tx: Prisma.TransactionClient, returnId: string): Promise<void> {
  const items = await tx.returnItem.findMany({ where: { returnId }, select: { total: true } });

  await tx.return.update({ where: { id: returnId }, data: { refundAmount: totalRefund(items.map((item) => item.total)) } });
}

async function restockableLines(tx: Prisma.TransactionClient, returnId: string): Promise<StockLine[]> {
  const items = await tx.returnItem.findMany({
    where: { returnId, restock: true },
    select: { productId: true, quantity: true, product: { select: { sku: true } } },
  });

  return items.map((item) => ({ productId: item.productId, quantity: item.quantity, sku: item.product.sku }));
}

/** What has already gone back to the customer against this order. */
async function refundedOnOrder(tx: Prisma.TransactionClient, orderId: string): Promise<Prisma.Decimal> {
  const refunds = await tx.payment.aggregate({
    where: { referenceType: PaymentReferenceType.RETURN, returnRecord: { orderId } },
    _sum: { amount: true },
  });

  return refunds._sum.amount ?? ZERO;
}
