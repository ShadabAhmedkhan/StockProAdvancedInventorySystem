import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/documents/document-number';
import { consumeStock, releaseStock, reserveStock, restoreStock, type StockLine } from '../common/inventory/stock-operations';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { AuditAction, AuditEntity, StockMovementType, StockReferenceType, StockTransferStatus } from '../generated/prisma/enums';
import { TENANT_PRISMA, type TenantPrismaClient, type TenantTransactionClient } from '../prisma/tenant-prisma.provider';
import type { CreateStockTransferItemDto } from './dto/create-stock-transfer-item.dto';
import type { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import type { StockTransferQueryDto } from './dto/stock-transfer-query.dto';
import type { UpdateStockTransferItemDto } from './dto/update-stock-transfer-item.dto';
import type { UpdateStockTransferDto } from './dto/update-stock-transfer.dto';
import {
  buildStockTransferWhere,
  STOCK_TRANSFER_DETAIL_INCLUDE,
  STOCK_TRANSFER_SUMMARY_INCLUDE,
  type StockTransferDetail,
  type StockTransferSummary,
} from './stock-transfer-views';

/**
 * The stock transfer lifecycle.
 *
 * ```text
 *   DRAFT --request--> REQUESTED --approve--> APPROVED --ship--> IN_TRANSIT --complete--> COMPLETED
 *     |                    |                      |
 *     +------cancel--------+--------cancel--------+   (refused once IN_TRANSIT or COMPLETED)
 * ```
 *
 * A draft is a basket, same as Order/PurchaseOrder: lines come and go and
 * nothing is promised. Requesting is a no-op on inventory - it just marks
 * intent. Approving is where the units are reserved at the source, so they
 * cannot be sold or transferred elsewhere out from under this transfer while
 * it is in flight. Shipping consumes at the source; completing restores at
 * the destination. Both are atomic with their status transition, exactly as
 * `PurchaseOrdersService.receiveGoods` does for goods receipts.
 *
 * Every transition is a conditional UPDATE on the transfer row, exactly as
 * `OrdersService`/`PurchaseOrdersService` do it, so two concurrent
 * transitions cannot both succeed.
 */
@Injectable()
export class StockTransfersService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: StockTransferQueryDto): Promise<Paginated<StockTransferSummary>> {
    const where = buildStockTransferWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({ where, include: STOCK_TRANSFER_SUMMARY_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<StockTransferDetail> {
    const transfer = await this.prisma.stockTransfer.findUnique({ where: { id }, include: STOCK_TRANSFER_DETAIL_INCLUDE });

    if (transfer === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Stock transfer not found' });
    }

    return transfer;
  }

  /** Opens a draft, with its opening lines if any were supplied. */
  async create(dto: CreateStockTransferDto, userId: string): Promise<StockTransferDetail> {
    const id = await this.prisma.$transaction(async (tx) => {
      await assertDifferentUsableLocations(tx, dto.sourceLocationId, dto.destinationLocationId);

      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId: getCurrentOrgId(),
          transferNumber: await nextDocumentNumber(tx, 'STOCK_TRANSFER'),
          sourceLocationId: dto.sourceLocationId,
          destinationLocationId: dto.destinationLocationId,
          notes: dto.notes ?? null,
          createdById: userId,
        },
        select: { id: true },
      });

      await insertItems(tx, transfer.id, dto.items ?? []);

      return transfer.id;
    });

    return this.findOne(id);
  }

  async update(id: string, dto: UpdateStockTransferDto): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      const current = await lockDraft(tx, id);

      const sourceLocationId = dto.sourceLocationId ?? current.sourceLocationId;
      const destinationLocationId = dto.destinationLocationId ?? current.destinationLocationId;

      if (dto.sourceLocationId !== undefined || dto.destinationLocationId !== undefined) {
        await assertDifferentUsableLocations(tx, sourceLocationId, destinationLocationId);
      }

      if (dto.sourceLocationId !== undefined || dto.destinationLocationId !== undefined || dto.notes !== undefined) {
        await tx.stockTransfer.update({
          where: { id },
          data: {
            ...(dto.sourceLocationId === undefined ? {} : { sourceLocationId: dto.sourceLocationId }),
            ...(dto.destinationLocationId === undefined ? {} : { destinationLocationId: dto.destinationLocationId }),
            ...(dto.notes === undefined ? {} : { notes: dto.notes }),
          },
        });
      }
    });

    return this.findOne(id);
  }

  async addItem(id: string, dto: CreateStockTransferItemDto): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockDraft(tx, id);
      await insertItem(tx, id, dto);
    });

    return this.findOne(id);
  }

  async updateItem(id: string, itemId: string, dto: UpdateStockTransferItemDto): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockDraft(tx, id);
      const item = await findItem(tx, id, itemId);

      await tx.stockTransferItem.update({ where: { id: itemId }, data: { quantity: dto.quantity ?? item.quantity } });
    });

    return this.findOne(id);
  }

  async removeItem(id: string, itemId: string): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      await lockDraft(tx, id);
      await findItem(tx, id, itemId);

      await tx.stockTransferItem.delete({ where: { id: itemId } });
    });

    return this.findOne(id);
  }

  /** Marks intent to move stock. No inventory effect. */
  async request(id: string): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, id, StockTransferStatus.DRAFT, StockTransferStatus.REQUESTED);

      const count = await tx.stockTransferItem.count({ where: { transferId: id } });

      if (count === 0) {
        throw new UnprocessableEntityException({
          code: ErrorCode.UNPROCESSABLE_ENTITY,
          message: 'A stock transfer needs at least one item before it can be requested',
        });
      }
    });

    return this.findOne(id);
  }

  /**
   * Sign-off gate that also reserves the units at the source, so they cannot
   * be claimed elsewhere while this transfer is in flight. Lines are frozen
   * from this point on, the same way Order.confirm freezes lines.
   */
  async approve(id: string, userId: string): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await transitionReturning(tx, id, StockTransferStatus.REQUESTED, StockTransferStatus.APPROVED);

      const lines = await stockLines(tx, id);
      await reserveStock(tx, lines, transfer.sourceLocationId);

      await this.auditService.record({ userId, action: AuditAction.STOCK_TRANSFER_APPROVED, entity: AuditEntity.STOCK_TRANSFER, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /** Ships: stock actually leaves the source, atomically with the transition. */
  async ship(id: string, userId: string): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await transitionReturning(tx, id, StockTransferStatus.APPROVED, StockTransferStatus.IN_TRANSIT);

      const lines = await stockLines(tx, id);
      await consumeStock(
        tx,
        lines,
        { type: StockMovementType.TRANSFER_OUT, referenceType: StockReferenceType.TRANSFER, referenceId: id, userId },
        transfer.sourceLocationId,
      );

      await this.auditService.record({ userId, action: AuditAction.STOCK_TRANSFER_SHIPPED, entity: AuditEntity.STOCK_TRANSFER, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /** Completes: stock arrives at the destination, atomically with the transition. */
  async complete(id: string, userId: string): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      const transfer = await transitionReturning(tx, id, StockTransferStatus.IN_TRANSIT, StockTransferStatus.COMPLETED);

      const lines = await stockLines(tx, id);

      // A destination location may never have held this product before, so
      // `restoreStock`'s plain UPDATE would find no row - unlike the source
      // (whose row is guaranteed by the reservation `approve()` already made),
      // the destination row has to be brought into existence here. The upsert
      // compiles to a single atomic `INSERT ... ON CONFLICT`, so two transfers
      // completing to the same brand-new (product, location) pair at once
      // cannot both try to insert and collide.
      await ensureInventoryRows(tx, lines, transfer.destinationLocationId);

      await restoreStock(
        tx,
        lines,
        { type: StockMovementType.TRANSFER_IN, referenceType: StockReferenceType.TRANSFER, referenceId: id, userId },
        transfer.destinationLocationId,
      );

      await this.auditService.record({ userId, action: AuditAction.STOCK_TRANSFER_COMPLETED, entity: AuditEntity.STOCK_TRANSFER, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /**
   * Calls the transfer off. Allowed from DRAFT, REQUESTED or APPROVED;
   * refused once IN_TRANSIT or COMPLETED, since stock has already physically
   * left the source at that point. Releases the source reservation if one was
   * made (i.e. the transfer had reached APPROVED).
   */
  async cancel(id: string, userId: string): Promise<StockTransferDetail> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.stockTransfer.findUnique({ where: { id }, select: { status: true, sourceLocationId: true } });

      if (current === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Stock transfer not found' });
      }

      const cancellableFrom: StockTransferStatus[] = [StockTransferStatus.DRAFT, StockTransferStatus.REQUESTED, StockTransferStatus.APPROVED];

      if (!cancellableFrom.includes(current.status)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `This stock transfer is ${current.status}; it can only be cancelled from DRAFT, REQUESTED or APPROVED`,
        });
      }

      const wasApproved = current.status === StockTransferStatus.APPROVED;

      await transition(tx, id, current.status, StockTransferStatus.CANCELLED);

      if (wasApproved) {
        const lines = await stockLines(tx, id);
        await releaseStock(tx, lines, current.sourceLocationId);
      }

      await this.auditService.record({ userId, action: AuditAction.STOCK_TRANSFER_CANCELLED, entity: AuditEntity.STOCK_TRANSFER, entityId: id }, tx);
    });

    return this.findOne(id);
  }
}

/**
 * Takes the transfer's row lock and asserts it is still a draft, in one
 * statement - the same pattern as `purchase-orders.service.ts`'s `lockDraft`.
 */
async function lockDraft(tx: TenantTransactionClient, id: string): Promise<{ sourceLocationId: string; destinationLocationId: string }> {
  const affected = await tx.$executeRaw`
    UPDATE "StockTransfer" SET "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = 'DRAFT'::"StockTransferStatus"
  `;

  if (affected === 0) {
    throw await explainRejectedTransition(tx, id, StockTransferStatus.DRAFT);
  }

  return tx.stockTransfer.findUniqueOrThrow({ where: { id }, select: { sourceLocationId: true, destinationLocationId: true } });
}

/** Moves the transfer between states, or explains why it will not move. */
async function transition(tx: TenantTransactionClient, id: string, from: StockTransferStatus, to: StockTransferStatus): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "StockTransfer"
    SET "status" = ${to}::"StockTransferStatus", "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = ${from}::"StockTransferStatus"
  `;

  if (affected === 0) {
    throw await explainRejectedTransition(tx, id, from);
  }
}

/** Same as {@link transition}, returning the row's locations for the stock-operations call that follows. */
async function transitionReturning(
  tx: TenantTransactionClient,
  id: string,
  from: StockTransferStatus,
  to: StockTransferStatus,
): Promise<{ sourceLocationId: string; destinationLocationId: string }> {
  await transition(tx, id, from, to);

  return tx.stockTransfer.findUniqueOrThrow({ where: { id }, select: { sourceLocationId: true, destinationLocationId: true } });
}

async function insertItem(tx: TenantTransactionClient, transferId: string, dto: CreateStockTransferItemDto): Promise<void> {
  const product = await tx.product.findUnique({ where: { id: dto.productId }, select: { sku: true, deletedAt: true } });

  // `undefined !== null` is true, so a missing product throws here too.
  if (product?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
  }

  const existing = await tx.stockTransferItem.findUnique({
    where: { transferId_productId: { transferId, productId: dto.productId } },
    select: { id: true },
  });

  if (existing !== null) {
    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `${product.sku} is already on this transfer; change the quantity on that line instead`,
    });
  }

  await tx.stockTransferItem.create({ data: { transferId, productId: dto.productId, quantity: dto.quantity } });
}

/** Batched version of {@link insertItem} for opening a draft with several lines at once. */
async function insertItems(tx: TenantTransactionClient, transferId: string, items: CreateStockTransferItemDto[]): Promise<void> {
  if (items.length === 0) return;

  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(items.map((item) => item.productId))] } },
    select: { id: true, sku: true, deletedAt: true },
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
        message: `${product.sku} is already on this transfer; change the quantity on that line instead`,
      });
    }
    seenProductIds.add(item.productId);

    return { transferId, productId: item.productId, quantity: item.quantity };
  });

  await tx.stockTransferItem.createMany({ data: rows });
}

async function findItem(tx: TenantTransactionClient, transferId: string, itemId: string): Promise<{ transferId: string; quantity: number }> {
  const item = await tx.stockTransferItem.findUnique({ where: { id: itemId }, select: { transferId: true, quantity: true } });

  // `undefined !== transferId` is true, so a missing item throws here too.
  if (item?.transferId !== transferId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That item is not on this stock transfer' });
  }

  return item;
}

/** The transfer's lines as `StockLine`s, for `stock-operations.ts`. */
async function stockLines(tx: TenantTransactionClient, transferId: string): Promise<StockLine[]> {
  const items = await tx.stockTransferItem.findMany({
    where: { transferId },
    select: { productId: true, quantity: true, product: { select: { sku: true } } },
  });

  return items.map((item) => ({ productId: item.productId, quantity: item.quantity, sku: item.product.sku }));
}

/** Brings a zero `Inventory` row into existence for each line at `locationId`, if one doesn't already exist. */
async function ensureInventoryRows(tx: TenantTransactionClient, lines: readonly StockLine[], locationId: string): Promise<void> {
  const organizationId = getCurrentOrgId();

  for (const line of lines) {
    await tx.inventory.upsert({
      where: { productId_locationId: { productId: line.productId, locationId } },
      create: { organizationId, productId: line.productId, locationId, quantity: 0, reservedQuantity: 0 },
      update: {},
    });
  }
}

async function assertDifferentUsableLocations(tx: TenantTransactionClient, sourceLocationId: string, destinationLocationId: string): Promise<void> {
  if (sourceLocationId === destinationLocationId) {
    throw new UnprocessableEntityException({
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      message: 'A stock transfer needs two different locations',
    });
  }

  const locations = await tx.location.findMany({
    where: { id: { in: [sourceLocationId, destinationLocationId] } },
    select: { id: true, deletedAt: true },
  });
  const byId = new Map(locations.map((location) => [location.id, location]));

  for (const id of [sourceLocationId, destinationLocationId]) {
    const location = byId.get(id);
    if (location?.deletedAt !== null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Location not found' });
    }
  }
}

/** Reached only on a failure path, so the extra read costs nothing normally. */
async function explainRejectedTransition(
  tx: TenantTransactionClient,
  id: string,
  from: StockTransferStatus,
): Promise<ConflictException | NotFoundException> {
  const transfer = await tx.stockTransfer.findUnique({ where: { id }, select: { status: true } });

  if (transfer === null) {
    return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Stock transfer not found' });
  }

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: `This stock transfer is ${transfer.status}; that action needs it to be ${from}`,
  });
}
