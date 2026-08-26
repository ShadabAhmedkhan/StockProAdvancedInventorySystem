import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/documents/document-number';
import { consumeStock, releaseStock, reserveStock, type StockLine } from '../common/inventory/stock-operations';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { Prisma, type Payment } from '../generated/prisma/client';
import {
  AuditAction,
  AuditEntity,
  OrderStatus,
  PaymentReferenceType,
  StockMovementType,
  StockReferenceType,
  TransactionReferenceType,
  TransactionType,
} from '../generated/prisma/enums';
import { TENANT_PRISMA, type TenantPrismaClient, type TenantTransactionClient } from '../prisma/tenant-prisma.provider';
import type { CreateOrderItemDto } from './dto/create-order-item.dto';
import type { CreatePaymentDto } from '../common/dto/create-payment.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { OrderQueryDto } from './dto/order-query.dto';
import type { UpdateOrderItemDto } from './dto/update-order-item.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';
import { lineGross, lineTotal, orderTotals, paymentStatusFor, ZERO, type LineAmounts } from './order-totals';
import { buildOrderWhere, ORDER_DETAIL_INCLUDE, ORDER_SUMMARY_INCLUDE, withOutstanding, type OrderDetail, type OrderSummary } from './order-views';

/**
 * The order lifecycle.
 *
 * ```text
 *   DRAFT ---confirm--> CONFIRMED ---complete--> COMPLETED
 *     |                     |
 *     +------cancel---------+-------> CANCELLED
 * ```
 *
 * A draft is a basket: lines come and go and nothing is promised. Confirming
 * reserves the stock, which is the moment those units stop being available to
 * anyone else, and freezes the lines - an agreed price cannot move afterwards.
 * Completing hands the goods over and writes the SALE movements. A completed
 * order is final; goods come back through a return, never by editing history.
 *
 * Every transition is a conditional UPDATE on the order row, so two clicks of
 * "confirm" cannot both succeed: the second blocks on the row lock and then
 * finds the order is no longer a draft. Draft edits take the same lock, so a
 * line cannot slip in beside a confirmation that is already under way.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: OrderQueryDto): Promise<Paginated<OrderSummary>> {
    const where = buildOrderWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    // Both halves in one transaction: counted separately, the page and the
    // total could disagree if a row were inserted between the two queries.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: ORDER_SUMMARY_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(items.map(withOutstanding), total, query.page, query.limit);
  }

  async findOne(id: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });

    if (order === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Order not found' });
    }

    return withOutstanding(order);
  }

  /** Opens a draft, with its opening lines if any were supplied. */
  async create(dto: CreateOrderDto, userId: string): Promise<OrderDetail> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertCustomerUsable(tx, dto.customerId);

      const order = await tx.order.create({
        data: {
          organizationId: getCurrentOrgId(),
          orderNumber: await nextDocumentNumber(tx, 'ORDER'),
          customerId: dto.customerId ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
        },
        select: { id: true },
      });

      await insertItems(tx, order.id, dto.items ?? []);

      await reprice(tx, order.id, money(dto.discount), money(dto.tax));

      return order.id;
    });

    return this.findOne(id);
  }

  async update(id: string, dto: UpdateOrderDto): Promise<OrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const order = await lockDraft(tx, id);
      await assertCustomerUsable(tx, dto.customerId);

      if (dto.customerId !== undefined || dto.notes !== undefined) {
        await tx.order.update({
          where: { id },
          data: {
            ...(dto.customerId === undefined ? {} : { customerId: dto.customerId }),
            ...(dto.notes === undefined ? {} : { notes: dto.notes }),
          },
        });
      }

      const discount = dto.discount === undefined ? order.discount : money(dto.discount);
      const tax = dto.tax === undefined ? order.tax : money(dto.tax);

      await reprice(tx, id, discount, tax);
    });

    return this.findOne(id);
  }

  async addItem(id: string, dto: CreateOrderItemDto): Promise<OrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const order = await lockDraft(tx, id);

      await insertItem(tx, id, dto);
      await reprice(tx, id, order.discount, order.tax);
    });

    return this.findOne(id);
  }

  async updateItem(id: string, itemId: string, dto: UpdateOrderItemDto): Promise<OrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const order = await lockDraft(tx, id);
      const item = await findItem(tx, id, itemId);

      const line: LineAmounts = {
        quantity: dto.quantity ?? item.quantity,
        unitPrice: dto.unitPrice === undefined ? item.unitPrice : money(dto.unitPrice),
        discount: dto.discount === undefined ? item.discount : money(dto.discount),
      };

      await tx.orderItem.update({ where: { id: itemId }, data: { ...line, total: pricedLine(line, item.product.sku) } });
      await reprice(tx, id, order.discount, order.tax);
    });

    return this.findOne(id);
  }

  async removeItem(id: string, itemId: string): Promise<OrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const order = await lockDraft(tx, id);
      await findItem(tx, id, itemId);

      await tx.orderItem.delete({ where: { id: itemId } });
      await reprice(tx, id, order.discount, order.tax);
    });

    return this.findOne(id);
  }

  /** Freezes the lines and claims the stock they need. */
  async confirm(id: string): Promise<OrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, OrderStatus.DRAFT, OrderStatus.CONFIRMED);

      const lines = await stockLines(tx, id);

      if (lines.length === 0) {
        throw new UnprocessableEntityException({
          code: ErrorCode.UNPROCESSABLE_ENTITY,
          message: 'An order needs at least one item before it can be confirmed',
        });
      }

      await reserveStock(tx, lines);
    });

    return this.findOne(id);
  }

  /** Hands the goods over: stock leaves and the ledger records why. */
  async complete(id: string, userId: string): Promise<OrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, OrderStatus.CONFIRMED, OrderStatus.COMPLETED);

      const lines = await stockLines(tx, id);

      await consumeStock(tx, lines, {
        type: StockMovementType.SALE,
        referenceType: StockReferenceType.ORDER,
        referenceId: id,
        userId,
      });

      await this.auditService.record({ userId, action: AuditAction.ORDER_COMPLETED, entity: AuditEntity.ORDER, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /**
   * Calls the sale off. A confirmed order gives its reservation back; a draft
   * never held one.
   */
  async cancel(id: string, userId: string): Promise<OrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id }, select: { status: true } });

      if (current === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Order not found' });
      }

      // The read only decides which transition to attempt. If it is already
      // stale the conditional UPDATE matches nothing and says so, so a
      // concurrent confirmation cannot be cancelled out from under itself.
      const from = current.status === OrderStatus.CONFIRMED ? OrderStatus.CONFIRMED : OrderStatus.DRAFT;

      await this.transition(tx, id, from, OrderStatus.CANCELLED);

      // Checked after the transition, which holds the row lock, so a payment
      // cannot land in the gap. Money that has already changed hands has to be
      // refunded through the returns and finance workflow; cancelling here
      // would leave a payment recorded against a sale that never happened.
      const { paidAmount } = await tx.order.findUniqueOrThrow({ where: { id }, select: { paidAmount: true } });

      if (paidAmount.gt(ZERO)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `This order has ${paidAmount.toFixed(2)} recorded against it; refund the payment before cancelling`,
        });
      }

      if (from === OrderStatus.CONFIRMED) {
        await releaseStock(tx, await stockLines(tx, id));
      }

      await this.auditService.record({ userId, action: AuditAction.ORDER_CANCELLED, entity: AuditEntity.ORDER, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /**
   * Records money received.
   *
   * The order's `paidAmount` is raised by the same statement that checks there
   * is room for it, so two cashiers taking payment at once cannot together
   * collect more than the total. Only then is the payment written, so a
   * rejected payment leaves no record of money that was never taken.
   */
  async addPayment(id: string, dto: CreatePaymentDto, userId: string): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ paidAmount: string; total: string }[]>`
        UPDATE "Order"
        SET "paidAmount" = "paidAmount" + ${dto.amount}::numeric, "updatedAt" = NOW()
        WHERE "id" = ${id}::uuid
          AND "status" IN ('CONFIRMED'::"OrderStatus", 'COMPLETED'::"OrderStatus")
          AND "paidAmount" + ${dto.amount}::numeric <= "total"
        RETURNING "paidAmount"::text AS "paidAmount", "total"::text AS "total"
      `;

      const row = rows[0];

      if (row === undefined) {
        throw await explainRejectedPayment(tx, id, money(dto.amount));
      }

      const organizationId = getCurrentOrgId();

      const payment = await tx.payment.create({
        data: {
          organizationId,
          paymentNumber: await nextDocumentNumber(tx, 'PAYMENT'),
          method: dto.method,
          amount: dto.amount,
          referenceType: PaymentReferenceType.ORDER,
          orderId: id,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          ...(dto.paidAt === undefined ? {} : { paidAt: dto.paidAt }),
          createdById: userId,
        },
      });

      await tx.financialTransaction.create({
        data: {
          organizationId,
          type: TransactionType.SALE,
          amount: payment.amount,
          description: `Order payment ${payment.paymentNumber}`,
          occurredAt: payment.paidAt,
          referenceType: TransactionReferenceType.ORDER,
          referenceId: id,
          createdById: userId,
        },
      });

      await this.auditService.record(
        {
          userId,
          action: AuditAction.PAYMENT_RECORDED,
          entity: AuditEntity.PAYMENT,
          entityId: payment.id,
          metadata: { amount: payment.amount.toFixed(2), method: payment.method, referenceType: payment.referenceType },
        },
        tx,
      );

      // Safe as a second statement: the update above holds the order's row
      // lock for the rest of the transaction, so nothing can change the
      // amounts this decision is based on.
      await tx.order.update({
        where: { id },
        data: { paymentStatus: paymentStatusFor(new Prisma.Decimal(row.paidAmount), new Prisma.Decimal(row.total)) },
      });

      return payment;
    });
  }

  async findPayments(id: string): Promise<Payment[]> {
    await this.findOne(id);

    return this.prisma.payment.findMany({ where: { orderId: id }, orderBy: { paidAt: 'asc' } });
  }

  /** Moves the order between states, or explains why it will not move. */
  private async transition(tx: TenantTransactionClient, id: string, from: OrderStatus, to: OrderStatus): Promise<void> {
    // Completion is the only transition that stamps a time, because revenue
    // reporting keys off it rather than off when the draft was raised.
    const completedAt = to === OrderStatus.COMPLETED ? Prisma.sql`, "completedAt" = NOW()` : Prisma.empty;

    const affected = await tx.$executeRaw`
      UPDATE "Order"
      SET "status" = ${to}::"OrderStatus", "updatedAt" = NOW()${completedAt}
      WHERE "id" = ${id}::uuid AND "status" = ${from}::"OrderStatus"
    `;

    if (affected === 0) {
      throw await explainRejectedTransition(tx, id, from);
    }
  }
}

/** Money arrives as an exact decimal string and becomes an exact Decimal. */
function money(value: string | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? '0');
}

/**
 * Takes the order's row lock and asserts it is still a draft, in one
 * statement. Everything that edits a draft starts here, so an edit and a
 * confirmation can never interleave, and returns the amounts the caller needs
 * to re-price the order.
 */
async function lockDraft(tx: TenantTransactionClient, id: string): Promise<{ discount: Prisma.Decimal; tax: Prisma.Decimal }> {
  const affected = await tx.$executeRaw`
    UPDATE "Order" SET "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = 'DRAFT'::"OrderStatus"
  `;

  if (affected === 0) {
    throw await explainRejectedTransition(tx, id, OrderStatus.DRAFT);
  }

  return tx.order.findUniqueOrThrow({ where: { id }, select: { discount: true, tax: true } });
}

async function insertItem(tx: TenantTransactionClient, orderId: string, dto: CreateOrderItemDto): Promise<void> {
  const product = await tx.product.findUnique({
    where: { id: dto.productId },
    select: { sku: true, sellingPrice: true, isActive: true, deletedAt: true },
  });

  // `undefined !== null` is true, so a missing product throws here too.
  if (product?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
  }

  if (!product.isActive) {
    throw new UnprocessableEntityException({ code: ErrorCode.UNPROCESSABLE_ENTITY, message: `${product.sku} has been withdrawn from sale` });
  }

  const existing = await tx.orderItem.findUnique({
    where: { orderId_productId: { orderId, productId: dto.productId } },
    select: { id: true },
  });

  if (existing !== null) {
    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `${product.sku} is already on this order; change the quantity on that line instead`,
    });
  }

  const line: LineAmounts = {
    quantity: dto.quantity,
    // The price is copied onto the line now, so a later catalogue change
    // cannot rewrite what the customer was charged.
    unitPrice: dto.unitPrice === undefined ? product.sellingPrice : money(dto.unitPrice),
    discount: money(dto.discount),
  };

  await tx.orderItem.create({ data: { orderId, productId: dto.productId, ...line, total: pricedLine(line, product.sku) } });
}

/** Batched version of {@link insertItem} for opening a draft with several lines at once:
 * one product lookup and one insert instead of two round-trips per line. Only usable when
 * `orderId` has no existing items yet (true for a brand-new draft), since that lets the
 * duplicate-productId check run in memory instead of a per-item query. */
async function insertItems(tx: TenantTransactionClient, orderId: string, items: CreateOrderItemDto[]): Promise<void> {
  if (items.length === 0) return;

  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(items.map((item) => item.productId))] } },
    select: { id: true, sku: true, sellingPrice: true, isActive: true, deletedAt: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const seenProductIds = new Set<string>();
  const rows = items.map((item) => {
    const product = byId.get(item.productId);
    if (product?.deletedAt !== null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
    }
    if (!product.isActive) {
      throw new UnprocessableEntityException({ code: ErrorCode.UNPROCESSABLE_ENTITY, message: `${product.sku} has been withdrawn from sale` });
    }
    if (seenProductIds.has(item.productId)) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `${product.sku} is already on this order; change the quantity on that line instead`,
      });
    }
    seenProductIds.add(item.productId);

    const line: LineAmounts = {
      quantity: item.quantity,
      unitPrice: item.unitPrice === undefined ? product.sellingPrice : money(item.unitPrice),
      discount: money(item.discount),
    };
    return { orderId, productId: item.productId, ...line, total: pricedLine(line, product.sku) };
  });

  await tx.orderItem.createMany({ data: rows });
}

async function findItem(tx: TenantTransactionClient, orderId: string, itemId: string): Promise<OrderItemForUpdate> {
  const item = await tx.orderItem.findUnique({
    where: { id: itemId },
    select: { orderId: true, quantity: true, unitPrice: true, discount: true, product: { select: { sku: true } } },
  });

  // `undefined !== orderId` is true, so a missing item throws here too. An
  // item belonging to a different order gets the same answer on purpose: the
  // caller has no business learning that it exists somewhere else.
  if (item?.orderId !== orderId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That item is not on this order' });
  }

  return item;
}

interface OrderItemForUpdate extends LineAmounts {
  orderId: string;
  product: { sku: string };
}

/** Prices one line, refusing a discount larger than the goods on it. */
function pricedLine(line: LineAmounts, sku: string): Prisma.Decimal {
  const gross = lineGross(line);

  if (line.discount.gt(gross)) {
    throw new UnprocessableEntityException({
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      message: `A discount of ${line.discount.toFixed(2)} on ${sku} is more than the line comes to (${gross.toFixed(2)})`,
    });
  }

  return lineTotal(line);
}

/**
 * Recomputes the order totals from the lines that are actually in the
 * database, so a total can never drift away from what it is the sum of.
 */
async function reprice(tx: TenantTransactionClient, orderId: string, discount: Prisma.Decimal, tax: Prisma.Decimal): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { quantity: true, unitPrice: true, discount: true } });
  const totals = orderTotals(items, discount, tax);

  if (discount.gt(totals.subtotal)) {
    throw new UnprocessableEntityException({
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      message: `An order discount of ${discount.toFixed(2)} is more than the order comes to (${totals.subtotal.toFixed(2)}); reduce the discount first`,
    });
  }

  await tx.order.update({ where: { id: orderId }, data: { subtotal: totals.subtotal, discount, tax, total: totals.total } });
}

async function stockLines(tx: TenantTransactionClient, orderId: string): Promise<StockLine[]> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, quantity: true, product: { select: { sku: true } } },
  });

  return items.map((item) => ({ productId: item.productId, quantity: item.quantity, sku: item.product.sku }));
}

async function assertCustomerUsable(tx: TenantTransactionClient, customerId: string | undefined): Promise<void> {
  if (customerId === undefined) {
    return;
  }

  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { deletedAt: true } });

  if (customer?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Customer not found' });
  }
}

/** Reached only on a failure path, so the extra read costs nothing normally. */
async function explainRejectedTransition(tx: TenantTransactionClient, id: string, from: OrderStatus): Promise<ConflictException | NotFoundException> {
  const order = await tx.order.findUnique({ where: { id }, select: { status: true } });

  if (order === null) {
    return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Order not found' });
  }

  return new ConflictException({ code: ErrorCode.CONFLICT, message: `This order is ${order.status}; that action needs it to be ${from}` });
}

async function explainRejectedPayment(tx: TenantTransactionClient, id: string, amount: Prisma.Decimal): Promise<ConflictException | NotFoundException> {
  const order = await tx.order.findUnique({ where: { id }, select: { status: true, total: true, paidAmount: true } });

  if (order === null) {
    return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Order not found' });
  }

  if (order.status !== OrderStatus.CONFIRMED && order.status !== OrderStatus.COMPLETED) {
    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `This order is ${order.status}; payment can only be recorded against a confirmed or completed order`,
    });
  }

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: `A payment of ${amount.toFixed(2)} is more than the ${order.total.sub(order.paidAmount).toFixed(2)} outstanding on this order`,
  });
}
