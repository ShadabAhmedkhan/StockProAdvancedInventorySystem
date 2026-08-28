import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/documents/document-number';
import { restoreStock, type StockLine } from '../common/inventory/stock-operations';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { Prisma, type GoodsReceipt } from '../generated/prisma/client';
import { AuditAction, AuditEntity, PurchaseOrderStatus, StockMovementType, StockReferenceType } from '../generated/prisma/enums';
import { TENANT_PRISMA, type TenantPrismaClient, type TenantTransactionClient } from '../prisma/tenant-prisma.provider';
import type { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import type { CreatePurchaseOrderItemDto } from './dto/create-purchase-order-item.dto';
import type { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import type { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import type { UpdatePurchaseOrderItemDto } from './dto/update-purchase-order-item.dto';
import type { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { lineGross, lineTotal, purchaseOrderTotals, type LineAmounts } from './purchase-order-totals';
import {
  buildPurchaseOrderWhere,
  PURCHASE_ORDER_DETAIL_INCLUDE,
  PURCHASE_ORDER_SUMMARY_INCLUDE,
  type PurchaseOrderDetail,
  type PurchaseOrderSummary,
} from './purchase-order-views';

/**
 * The purchase order lifecycle.
 *
 * ```text
 *   DRAFT --approve--> APPROVED --order--> ORDERED --receive--> PARTIALLY_RECEIVED --receive--> RECEIVED
 *     |                    |                   |
 *     +------cancel--------+-------cancel------+---------> CANCELLED
 * ```
 *
 * A draft is a basket, same as Order: lines come and go and nothing is
 * promised. Approving is a sign-off gate with no inventory effect - bigger
 * orgs want that before anything goes to a supplier. Ordering marks it as
 * sent, still with no inventory effect: neither creates any expectation on
 * Inventory the way Order.confirm's reservation does, because there is
 * nothing on the shelf yet to reserve. Only a GoodsReceipt moves stock, and it
 * does so atomically with the ledger entry and the status re-evaluation.
 *
 * Every transition is a conditional UPDATE on the purchase order row, exactly
 * as `OrdersService` does it, so two concurrent transitions cannot both
 * succeed.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: PurchaseOrderQueryDto): Promise<Paginated<PurchaseOrderSummary>> {
    const where = buildPurchaseOrderWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({ where, include: PURCHASE_ORDER_SUMMARY_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<PurchaseOrderDetail> {
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: PURCHASE_ORDER_DETAIL_INCLUDE });

    if (purchaseOrder === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Purchase order not found' });
    }

    return purchaseOrder;
  }

  /** Opens a draft, with its opening lines if any were supplied. */
  async create(dto: CreatePurchaseOrderDto, userId: string): Promise<PurchaseOrderDetail> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertSupplierUsable(tx, dto.supplierId);

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          organizationId: getCurrentOrgId(),
          poNumber: await nextDocumentNumber(tx, 'PURCHASE_ORDER'),
          supplierId: dto.supplierId,
          expectedDate: dto.expectedDate ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
        },
        select: { id: true },
      });

      await insertItems(tx, purchaseOrder.id, dto.items ?? []);

      await reprice(tx, purchaseOrder.id, money(dto.discount), money(dto.tax), money(dto.shipping));

      return purchaseOrder.id;
    });

    return this.findOne(id);
  }

  async update(id: string, dto: UpdatePurchaseOrderDto): Promise<PurchaseOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await lockDraft(tx, id);

      if (dto.supplierId !== undefined) {
        await assertSupplierUsable(tx, dto.supplierId);
      }

      if (dto.supplierId !== undefined || dto.expectedDate !== undefined || dto.notes !== undefined) {
        await tx.purchaseOrder.update({
          where: { id },
          data: {
            ...(dto.supplierId === undefined ? {} : { supplierId: dto.supplierId }),
            ...(dto.expectedDate === undefined ? {} : { expectedDate: dto.expectedDate }),
            ...(dto.notes === undefined ? {} : { notes: dto.notes }),
          },
        });
      }

      const discount = dto.discount === undefined ? purchaseOrder.discount : money(dto.discount);
      const tax = dto.tax === undefined ? purchaseOrder.tax : money(dto.tax);
      const shipping = dto.shipping === undefined ? purchaseOrder.shipping : money(dto.shipping);

      await reprice(tx, id, discount, tax, shipping);
    });

    return this.findOne(id);
  }

  async addItem(id: string, dto: CreatePurchaseOrderItemDto): Promise<PurchaseOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await lockDraft(tx, id);

      await insertItem(tx, id, dto);
      await reprice(tx, id, purchaseOrder.discount, purchaseOrder.tax, purchaseOrder.shipping);
    });

    return this.findOne(id);
  }

  async updateItem(id: string, itemId: string, dto: UpdatePurchaseOrderItemDto): Promise<PurchaseOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await lockDraft(tx, id);
      const item = await findItem(tx, id, itemId);

      const line: LineAmounts = {
        quantity: dto.quantity ?? item.quantity,
        unitCost: dto.unitCost === undefined ? item.unitCost : money(dto.unitCost),
        discount: dto.discount === undefined ? item.discount : money(dto.discount),
      };

      await tx.purchaseOrderItem.update({ where: { id: itemId }, data: { ...line, total: pricedLine(line, item.product.sku) } });
      await reprice(tx, id, purchaseOrder.discount, purchaseOrder.tax, purchaseOrder.shipping);
    });

    return this.findOne(id);
  }

  async removeItem(id: string, itemId: string): Promise<PurchaseOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await lockDraft(tx, id);
      await findItem(tx, id, itemId);

      await tx.purchaseOrderItem.delete({ where: { id: itemId } });
      await reprice(tx, id, purchaseOrder.discount, purchaseOrder.tax, purchaseOrder.shipping);
    });

    return this.findOne(id);
  }

  /** Sign-off gate: no inventory effect, just a state gate. */
  async approve(id: string): Promise<PurchaseOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, id, PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.APPROVED);

      const count = await tx.purchaseOrderItem.count({ where: { purchaseOrderId: id } });

      if (count === 0) {
        throw new UnprocessableEntityException({
          code: ErrorCode.UNPROCESSABLE_ENTITY,
          message: 'A purchase order needs at least one item before it can be approved',
        });
      }
    });

    return this.findOne(id);
  }

  /** Marks the order as sent to the supplier. Still no inventory effect. */
  async order(id: string, userId: string): Promise<PurchaseOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, id, PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.ORDERED);
      await this.auditService.record({ userId, action: AuditAction.PURCHASE_ORDER_ORDERED, entity: AuditEntity.PURCHASE_ORDER, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /** Calls the purchase off. Refused once any goods have been received against it. */
  async cancel(id: string, userId: string): Promise<PurchaseOrderDetail> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true } });

      if (current === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Purchase order not found' });
      }

      const cancellableFrom: PurchaseOrderStatus[] = [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.ORDERED];

      if (!cancellableFrom.includes(current.status)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `This purchase order is ${current.status}; it can only be cancelled from DRAFT, APPROVED or ORDERED`,
        });
      }

      await transition(tx, id, current.status, PurchaseOrderStatus.CANCELLED);

      // Checked after the transition, which holds the row lock, so a goods
      // receipt cannot land in the gap.
      const receiptCount = await tx.goodsReceipt.count({ where: { purchaseOrderId: id } });

      if (receiptCount > 0) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: 'This purchase order has goods received against it; it can no longer be cancelled',
        });
      }

      await this.auditService.record({ userId, action: AuditAction.PURCHASE_ORDER_CANCELLED, entity: AuditEntity.PURCHASE_ORDER, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /**
   * Records a delivery against an ORDERED or PARTIALLY_RECEIVED purchase
   * order. In one transaction: each line's outstanding quantity is claimed by
   * a conditional UPDATE on `PurchaseOrderItem.receivedQuantity` (the same
   * pattern as `Inventory.reservedQuantity`), stock is restored via
   * `restoreStock`, an audit record is written, and the purchase order's
   * status is re-evaluated from what every line now shows as received.
   */
  async receiveGoods(id: string, dto: CreateGoodsReceiptDto, userId: string): Promise<GoodsReceipt> {
    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true } });

      if (purchaseOrder === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Purchase order not found' });
      }

      const receivableFrom: PurchaseOrderStatus[] = [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED];

      if (!receivableFrom.includes(purchaseOrder.status)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `This purchase order is ${purchaseOrder.status}; goods can only be received against an ORDERED or PARTIALLY_RECEIVED order`,
        });
      }

      const goodsReceipt = await tx.goodsReceipt.create({
        data: {
          organizationId: getCurrentOrgId(),
          grNumber: await nextDocumentNumber(tx, 'GOODS_RECEIPT'),
          purchaseOrderId: id,
          note: dto.note ?? null,
          createdById: userId,
        },
        select: { id: true },
      });

      const stockLines: StockLine[] = [];
      const receiptItems: Prisma.GoodsReceiptItemCreateManyInput[] = [];

      for (const line of dto.items) {
        const item = await claimReceivedQuantity(tx, id, line.purchaseOrderItemId, line.quantityReceived);

        stockLines.push({ productId: item.productId, quantity: line.quantityReceived, sku: item.sku });
        receiptItems.push({ goodsReceiptId: goodsReceipt.id, purchaseOrderItemId: line.purchaseOrderItemId, quantityReceived: line.quantityReceived });
      }

      await tx.goodsReceiptItem.createMany({ data: receiptItems });

      await restoreStock(tx, stockLines, {
        type: StockMovementType.PURCHASE,
        referenceType: StockReferenceType.PURCHASE,
        referenceId: goodsReceipt.id,
        userId,
      });

      await this.auditService.record(
        { userId, action: AuditAction.GOODS_RECEIPT_RECORDED, entity: AuditEntity.GOODS_RECEIPT, entityId: goodsReceipt.id },
        tx,
      );

      const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id }, select: { quantity: true, receivedQuantity: true } });
      const fullyReceived = items.every((row) => row.receivedQuantity >= row.quantity);

      await tx.purchaseOrder.update({
        where: { id },
        data: { status: fullyReceived ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED },
      });

      return tx.goodsReceipt.findUniqueOrThrow({ where: { id: goodsReceipt.id } });
    });
  }

  async findGoodsReceipts(id: string): Promise<GoodsReceipt[]> {
    await this.findOne(id);

    return this.prisma.goodsReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { createdAt: 'asc' }, include: { items: true } });
  }
}

/** Money arrives as an exact decimal string and becomes an exact Decimal. */
function money(value: string | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? '0');
}

/**
 * Takes the purchase order's row lock and asserts it is still a draft, in one
 * statement - the same pattern as `orders.service.ts`'s `lockDraft`.
 */
async function lockDraft(
  tx: TenantTransactionClient,
  id: string,
): Promise<{ discount: Prisma.Decimal; tax: Prisma.Decimal; shipping: Prisma.Decimal }> {
  const affected = await tx.$executeRaw`
    UPDATE "PurchaseOrder" SET "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = 'DRAFT'::"PurchaseOrderStatus"
  `;

  if (affected === 0) {
    throw await explainRejectedTransition(tx, id, PurchaseOrderStatus.DRAFT);
  }

  return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, select: { discount: true, tax: true, shipping: true } });
}

/** Moves the purchase order between states, or explains why it will not move. */
async function transition(tx: TenantTransactionClient, id: string, from: PurchaseOrderStatus, to: PurchaseOrderStatus): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "PurchaseOrder"
    SET "status" = ${to}::"PurchaseOrderStatus", "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = ${from}::"PurchaseOrderStatus"
  `;

  if (affected === 0) {
    throw await explainRejectedTransition(tx, id, from);
  }
}

async function insertItem(tx: TenantTransactionClient, purchaseOrderId: string, dto: CreatePurchaseOrderItemDto): Promise<void> {
  const product = await tx.product.findUnique({
    where: { id: dto.productId },
    select: { sku: true, costPrice: true, deletedAt: true },
  });

  // `undefined !== null` is true, so a missing product throws here too.
  if (product?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
  }

  const existing = await tx.purchaseOrderItem.findUnique({
    where: { purchaseOrderId_productId: { purchaseOrderId, productId: dto.productId } },
    select: { id: true },
  });

  if (existing !== null) {
    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `${product.sku} is already on this purchase order; change the quantity on that line instead`,
    });
  }

  const line: LineAmounts = {
    quantity: dto.quantity,
    // The cost is copied onto the line now, so a later catalogue change
    // cannot rewrite what was agreed with the supplier.
    unitCost: dto.unitCost === undefined ? product.costPrice : money(dto.unitCost),
    discount: money(dto.discount),
  };

  await tx.purchaseOrderItem.create({ data: { purchaseOrderId, productId: dto.productId, ...line, total: pricedLine(line, product.sku) } });
}

/** Batched version of {@link insertItem} for opening a draft with several lines at once. */
async function insertItems(tx: TenantTransactionClient, purchaseOrderId: string, items: CreatePurchaseOrderItemDto[]): Promise<void> {
  if (items.length === 0) return;

  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(items.map((item) => item.productId))] } },
    select: { id: true, sku: true, costPrice: true, deletedAt: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const seenProductIds = new Set<string>();
  const rows = items.map((item) => {
    const product = byId.get(item.productId);
    if (product?.deletedAt !== null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
    }
    if (seenProductIds.has(item.productId)) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: `${product.sku} is already on this purchase order; change the quantity on that line instead`,
      });
    }
    seenProductIds.add(item.productId);

    const line: LineAmounts = {
      quantity: item.quantity,
      unitCost: item.unitCost === undefined ? product.costPrice : money(item.unitCost),
      discount: money(item.discount),
    };
    return { purchaseOrderId, productId: item.productId, ...line, total: pricedLine(line, product.sku) };
  });

  await tx.purchaseOrderItem.createMany({ data: rows });
}

async function findItem(tx: TenantTransactionClient, purchaseOrderId: string, itemId: string): Promise<PurchaseOrderItemForUpdate> {
  const item = await tx.purchaseOrderItem.findUnique({
    where: { id: itemId },
    select: { purchaseOrderId: true, quantity: true, unitCost: true, discount: true, product: { select: { sku: true } } },
  });

  // `undefined !== purchaseOrderId` is true, so a missing item throws here too.
  if (item?.purchaseOrderId !== purchaseOrderId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That item is not on this purchase order' });
  }

  return item;
}

interface PurchaseOrderItemForUpdate extends LineAmounts {
  purchaseOrderId: string;
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

/** Recomputes the purchase order totals from the lines actually in the database. */
async function reprice(
  tx: TenantTransactionClient,
  purchaseOrderId: string,
  discount: Prisma.Decimal,
  tax: Prisma.Decimal,
  shipping: Prisma.Decimal,
): Promise<void> {
  const items = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId }, select: { quantity: true, unitCost: true, discount: true } });
  const totals = purchaseOrderTotals(items, discount, tax, shipping);

  if (discount.gt(totals.subtotal)) {
    throw new UnprocessableEntityException({
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      message: `A purchase order discount of ${discount.toFixed(2)} is more than the order comes to (${totals.subtotal.toFixed(2)}); reduce the discount first`,
    });
  }

  await tx.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { subtotal: totals.subtotal, discount, tax, shipping, total: totals.total },
  });
}

async function assertSupplierUsable(tx: TenantTransactionClient, supplierId: string): Promise<void> {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { deletedAt: true } });

  if (supplier?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Supplier not found' });
  }
}

/**
 * Claims `quantityReceived` units against one purchase order line with a
 * single conditional UPDATE - `receivedQuantity + n <= quantity` is the
 * guard, so two receipts racing to receive more than what remains outstanding
 * cannot both succeed, the same way `reserveStock` guards `Inventory`.
 */
async function claimReceivedQuantity(
  tx: TenantTransactionClient,
  purchaseOrderId: string,
  purchaseOrderItemId: string,
  quantityReceived: number,
): Promise<{ productId: string; sku: string }> {
  const rows = await tx.$queryRaw<{ productId: string }[]>`
    UPDATE "PurchaseOrderItem"
    SET "receivedQuantity" = "receivedQuantity" + ${quantityReceived}, "updatedAt" = NOW()
    WHERE "id" = ${purchaseOrderItemId}::uuid
      AND "purchaseOrderId" = ${purchaseOrderId}::uuid
      AND "quantity" - "receivedQuantity" >= ${quantityReceived}
    RETURNING "productId"::text AS "productId"
  `;

  const row = rows[0];

  if (row === undefined) {
    throw await explainRejectedReceipt(tx, purchaseOrderId, purchaseOrderItemId, quantityReceived);
  }

  const product = await tx.product.findUniqueOrThrow({ where: { id: row.productId }, select: { sku: true } });

  return { productId: row.productId, sku: product.sku };
}

/** Reached only on a failure path, so the extra reads cost nothing normally. */
async function explainRejectedReceipt(
  tx: TenantTransactionClient,
  purchaseOrderId: string,
  purchaseOrderItemId: string,
  quantityReceived: number,
): Promise<NotFoundException | ConflictException> {
  const item = await tx.purchaseOrderItem.findUnique({
    where: { id: purchaseOrderItemId },
    select: { purchaseOrderId: true, quantity: true, receivedQuantity: true, product: { select: { sku: true } } },
  });

  if (item?.purchaseOrderId !== purchaseOrderId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That item is not on this purchase order' });
  }

  const outstanding = item.quantity - item.receivedQuantity;

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: `Cannot receive ${String(quantityReceived)} units of ${item.product.sku}: only ${String(outstanding)} remain outstanding on that line`,
  });
}

/** Reached only on a failure path, so the extra read costs nothing normally. */
async function explainRejectedTransition(
  tx: TenantTransactionClient,
  id: string,
  from: PurchaseOrderStatus,
): Promise<ConflictException | NotFoundException> {
  const purchaseOrder = await tx.purchaseOrder.findUnique({ where: { id }, select: { status: true } });

  if (purchaseOrder === null) {
    return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Purchase order not found' });
  }

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: `This purchase order is ${purchaseOrder.status}; that action needs it to be ${from}`,
  });
}

