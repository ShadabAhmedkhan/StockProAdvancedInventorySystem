import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { nextDocumentNumber } from '../common/documents/document-number';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { AuditAction, AuditEntity, StockCountStatus, StockMovementType, StockReferenceType } from '../generated/prisma/enums';
import { TENANT_PRISMA, type TenantPrismaClient, type TenantTransactionClient } from '../prisma/tenant-prisma.provider';
import type { CreateStockCountItemDto } from './dto/create-stock-count-item.dto';
import type { CreateStockCountDto } from './dto/create-stock-count.dto';
import type { StockCountQueryDto } from './dto/stock-count-query.dto';
import type { SubmitCountDto } from './dto/submit-count.dto';
import type { UpdateStockCountDto } from './dto/update-stock-count.dto';
import {
  buildStockCountWhere,
  STOCK_COUNT_DETAIL_INCLUDE,
  STOCK_COUNT_SUMMARY_INCLUDE,
  withBlindCounting,
  type StockCountDetailView,
  type StockCountSummary,
} from './stock-count-views';

/**
 * The stock count lifecycle.
 *
 * ```text
 *   DRAFT --start--> COUNTING --submitForReview--> REVIEW --approve--> APPROVED --complete--> COMPLETED
 *     |                  |                            |
 *     +-----cancel-------+-----------cancel------------+
 * ```
 *
 * DRAFT is where items are chosen and their `expectedQuantity` snapshotted
 * from `Inventory` - a count compares against what the system believed at the
 * moment it opened, not a number that keeps moving under it. COUNTING is
 * where staff enter physical counts, blind to the expected quantity (see
 * `withBlindCounting`). REVIEW exposes the variance for a manager to check.
 * `approve` is the only step that touches stock: every line with a non-zero
 * variance is applied to `Inventory` by the same conditional-UPDATE pattern as
 * `StockService.adjust`, atomically with its `StockMovement`, in one
 * transaction. `complete` is then just a closing formality.
 */
@Injectable()
export class StockCountsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: StockCountQueryDto): Promise<Paginated<StockCountSummary>> {
    const where = buildStockCountWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockCount.findMany({ where, include: STOCK_COUNT_SUMMARY_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.stockCount.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<StockCountDetailView> {
    const stockCount = await this.prisma.stockCount.findUnique({ where: { id }, include: STOCK_COUNT_DETAIL_INCLUDE });

    if (stockCount === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Stock count not found' });
    }

    return withBlindCounting(stockCount);
  }

  /**
   * Opens a draft. With no `productIds`, every active product already holding
   * an inventory row at the location is included - the common "count
   * everything here" case - rather than making the caller enumerate them.
   */
  async create(dto: CreateStockCountDto, userId: string): Promise<StockCountDetailView> {
    await assertLocationUsable(this.prisma, dto.locationId);

    const id = await this.prisma.$transaction(async (tx) => {
      const stockCount = await tx.stockCount.create({
        data: {
          organizationId: getCurrentOrgId(),
          countNumber: await nextDocumentNumber(tx, 'STOCK_COUNT'),
          locationId: dto.locationId,
          notes: dto.notes ?? null,
          createdById: userId,
        },
        select: { id: true },
      });

      const productIds = dto.productIds ?? (await activeProductIdsAtLocation(tx, dto.locationId));
      await snapshotItems(tx, stockCount.id, dto.locationId, productIds);

      return stockCount.id;
    });

    return this.findOne(id);
  }

  async update(id: string, dto: UpdateStockCountDto): Promise<StockCountDetailView> {
    await this.findOne(id);

    if (dto.notes !== undefined) {
      await this.prisma.stockCount.update({ where: { id }, data: { notes: dto.notes } });
    }

    return this.findOne(id);
  }

  /** Adds one more product to a draft, snapshotting its current on-hand quantity. */
  async addItem(id: string, dto: CreateStockCountItemDto): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      const stockCount = await lockDraft(tx, id);

      const existing = await tx.stockCountItem.findUnique({
        where: { stockCountId_productId: { stockCountId: id, productId: dto.productId } },
        select: { id: true },
      });
      if (existing !== null) {
        throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'This product is already on the count' });
      }

      await snapshotItems(tx, id, stockCount.locationId, [dto.productId]);
    });

    return this.findOne(id);
  }

  async removeItem(id: string, itemId: string): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      await lockDraft(tx, id);
      await findItem(tx, id, itemId);

      await tx.stockCountItem.delete({ where: { id: itemId } });
    });

    return this.findOne(id);
  }

  /** Opens counting. Refused with nothing to count. */
  async start(id: string): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, id, StockCountStatus.DRAFT, StockCountStatus.COUNTING);

      const count = await tx.stockCountItem.count({ where: { stockCountId: id } });
      if (count === 0) {
        throw new UnprocessableEntityException({ code: ErrorCode.UNPROCESSABLE_ENTITY, message: 'A stock count needs at least one item before counting can start' });
      }
    });

    return this.findOne(id);
  }

  /**
   * Records what was physically found for one line. Re-submitting the same
   * line is a recount: it simply overwrites the previous value while the
   * count is still COUNTING.
   */
  async submitCount(id: string, itemId: string, dto: SubmitCountDto): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      const stockCount = await tx.stockCount.findUnique({ where: { id }, select: { status: true } });
      if (stockCount === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Stock count not found' });
      }
      if (stockCount.status !== StockCountStatus.COUNTING) {
        throw new ConflictException({ code: ErrorCode.CONFLICT, message: `This stock count is ${stockCount.status}; counts can only be entered while it is COUNTING` });
      }

      await findItem(tx, id, itemId);
      await tx.stockCountItem.update({ where: { id: itemId }, data: { countedQuantity: dto.countedQuantity, notes: dto.notes ?? null } });
    });

    return this.findOne(id);
  }

  /** Closes counting for review. Refused while any line is still uncounted. */
  async submitForReview(id: string): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, id, StockCountStatus.COUNTING, StockCountStatus.REVIEW);

      const uncounted = await tx.stockCountItem.count({ where: { stockCountId: id, countedQuantity: null } });
      if (uncounted > 0) {
        throw new UnprocessableEntityException({
          code: ErrorCode.UNPROCESSABLE_ENTITY,
          message: `${String(uncounted)} item(s) still have no counted quantity`,
        });
      }
    });

    return this.findOne(id);
  }

  /**
   * The only step that touches stock. Every line whose counted quantity
   * differs from what was expected is applied to `Inventory` by a conditional
   * UPDATE, atomically with a `StockMovement`, in the same transaction that
   * moves the count to APPROVED - so a crash midway leaves either all of it
   * done or none of it, never a mix of adjusted and unadjusted lines.
   */
  async approve(id: string, userId: string): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      const stockCount = await transitionReturning(tx, id, StockCountStatus.REVIEW, StockCountStatus.APPROVED);

      const items = await tx.stockCountItem.findMany({
        where: { stockCountId: id },
        select: { id: true, productId: true, expectedQuantity: true, countedQuantity: true, product: { select: { sku: true } } },
      });

      for (const item of items) {
        const variance = (item.countedQuantity ?? 0) - item.expectedQuantity;
        if (variance === 0) continue;

        await applyVariance(tx, stockCount.locationId, item.productId, item.product.sku, variance, id, userId);
      }

      await tx.stockCount.update({ where: { id }, data: { approvedById: userId, approvedAt: new Date() } });

      await this.auditService.record({ userId, action: AuditAction.STOCK_COUNT_APPROVED, entity: AuditEntity.STOCK_COUNT, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /** Closing formality: the adjustments already happened at `approve`. */
  async complete(id: string, userId: string): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      await transition(tx, id, StockCountStatus.APPROVED, StockCountStatus.COMPLETED);
      await tx.stockCount.update({ where: { id }, data: { completedAt: new Date() } });
      await this.auditService.record({ userId, action: AuditAction.STOCK_COUNT_COMPLETED, entity: AuditEntity.STOCK_COUNT, entityId: id }, tx);
    });

    return this.findOne(id);
  }

  /** Refused once stock has been adjusted - a count cannot be called off after that. */
  async cancel(id: string, userId: string): Promise<StockCountDetailView> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.stockCount.findUnique({ where: { id }, select: { status: true } });
      if (current === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Stock count not found' });
      }

      const cancellableFrom: StockCountStatus[] = [StockCountStatus.DRAFT, StockCountStatus.COUNTING, StockCountStatus.REVIEW];
      if (!cancellableFrom.includes(current.status)) {
        throw new ConflictException({
          code: ErrorCode.CONFLICT,
          message: `This stock count is ${current.status}; it can only be cancelled from DRAFT, COUNTING or REVIEW`,
        });
      }

      await transition(tx, id, current.status, StockCountStatus.CANCELLED);
      await this.auditService.record({ userId, action: AuditAction.STOCK_COUNT_CANCELLED, entity: AuditEntity.STOCK_COUNT, entityId: id }, tx);
    });

    return this.findOne(id);
  }
}

async function assertLocationUsable(prisma: TenantPrismaClient, locationId: string): Promise<void> {
  const location = await prisma.location.findUnique({ where: { id: locationId }, select: { deletedAt: true } });

  if (location?.deletedAt !== null) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Location not found' });
  }
}

async function activeProductIdsAtLocation(tx: TenantTransactionClient, locationId: string): Promise<string[]> {
  const inventory = await tx.inventory.findMany({
    where: { locationId, product: { isActive: true, deletedAt: null } },
    select: { productId: true },
  });

  return inventory.map((row) => row.productId);
}

async function snapshotItems(tx: TenantTransactionClient, stockCountId: string, locationId: string, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;

  const inventory = await tx.inventory.findMany({
    where: { locationId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  const quantityByProduct = new Map(inventory.map((row) => [row.productId, row.quantity]));

  const rows = productIds.map((productId) => ({
    stockCountId,
    productId,
    // A product with no inventory row at this location has never held stock
    // there - expected is zero, and counting it still catches phantom stock.
    expectedQuantity: quantityByProduct.get(productId) ?? 0,
  }));

  await tx.stockCountItem.createMany({ data: rows });
}

async function findItem(tx: TenantTransactionClient, stockCountId: string, itemId: string): Promise<{ id: string }> {
  const item = await tx.stockCountItem.findUnique({ where: { id: itemId }, select: { stockCountId: true } });

  // `undefined !== stockCountId` is true, so a missing item throws here too.
  if (item?.stockCountId !== stockCountId) {
    throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'That item is not on this stock count' });
  }

  return { id: itemId };
}

/** Takes the count's row lock and asserts it is still a draft, in one statement. */
async function lockDraft(tx: TenantTransactionClient, id: string): Promise<{ locationId: string }> {
  const affected = await tx.$executeRaw`
    UPDATE "StockCount" SET "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = 'DRAFT'::"StockCountStatus"
  `;

  if (affected === 0) {
    throw await explainRejectedTransition(tx, id, StockCountStatus.DRAFT);
  }

  return tx.stockCount.findUniqueOrThrow({ where: { id }, select: { locationId: true } });
}

async function transition(tx: TenantTransactionClient, id: string, from: StockCountStatus, to: StockCountStatus): Promise<void> {
  await transitionReturning(tx, id, from, to);
}

/** Same as {@link transition}, but hands back the row for callers that need more than the status change. */
async function transitionReturning(
  tx: TenantTransactionClient,
  id: string,
  from: StockCountStatus,
  to: StockCountStatus,
): Promise<{ locationId: string }> {
  const affected = await tx.$executeRaw`
    UPDATE "StockCount"
    SET "status" = ${to}::"StockCountStatus", "updatedAt" = NOW()
    WHERE "id" = ${id}::uuid AND "status" = ${from}::"StockCountStatus"
  `;

  if (affected === 0) {
    throw await explainRejectedTransition(tx, id, from);
  }

  return tx.stockCount.findUniqueOrThrow({ where: { id }, select: { locationId: true } });
}

async function explainRejectedTransition(tx: TenantTransactionClient, id: string, from: StockCountStatus): Promise<ConflictException | NotFoundException> {
  const stockCount = await tx.stockCount.findUnique({ where: { id }, select: { status: true } });

  if (stockCount === null) {
    return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Stock count not found' });
  }

  return new ConflictException({
    code: ErrorCode.CONFLICT,
    message: `This stock count is ${stockCount.status}; that action needs it to be ${from}`,
  });
}

/**
 * Applies one line's variance to `Inventory` with the same conditional-UPDATE
 * guard as `StockService.adjust` (`quantity + delta >= reservedQuantity`), and
 * writes the matching `StockMovement`. A count that would take stock below
 * what is already reserved is rejected line by line, same as a manual
 * adjustment would be.
 */
async function applyVariance(
  tx: TenantTransactionClient,
  locationId: string,
  productId: string,
  sku: string,
  variance: number,
  stockCountId: string,
  userId: string,
): Promise<void> {
  const affected = await tx.$executeRaw`
    UPDATE "Inventory"
    SET "quantity" = "quantity" + ${variance}, "updatedAt" = NOW()
    WHERE "productId" = ${productId}::uuid
      AND "organizationId" = ${getCurrentOrgId()}::uuid
      AND "locationId" = ${locationId}::uuid
      AND "quantity" + ${variance} >= "reservedQuantity"
  `;

  if (affected === 0) {
    const inventory = await tx.inventory.findUnique({ where: { productId_locationId: { productId, locationId } }, select: { quantity: true, reservedQuantity: true } });
    const onHand = inventory?.quantity ?? 0;
    const reserved = inventory?.reservedQuantity ?? 0;
    throw new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `Cannot apply a variance of ${String(variance)} to ${sku}: ${String(onHand)} on hand with ${String(reserved)} already reserved`,
    });
  }

  const inventory = await tx.inventory.findUniqueOrThrow({ where: { productId_locationId: { productId, locationId } }, select: { quantity: true } });

  await tx.stockMovement.create({
    data: {
      organizationId: getCurrentOrgId(),
      productId,
      locationId,
      type: variance > 0 ? StockMovementType.ADJUSTMENT_IN : StockMovementType.ADJUSTMENT_OUT,
      quantity: Math.abs(variance),
      previousQuantity: inventory.quantity - variance,
      newQuantity: inventory.quantity,
      referenceType: StockReferenceType.STOCK_COUNT,
      referenceId: stockCountId,
      createdById: userId,
    },
  });
}
