import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { Prisma } from '../generated/prisma/client';
import { AuditAction, AuditEntity, StockMovementType, StockReferenceType } from '../generated/prisma/enums';
import { TENANT_PRISMA, type TenantPrismaClient, type TenantTransactionClient } from '../prisma/tenant-prisma.provider';
import type { AdjustStockDto, ManualMovementType } from './dto/adjust-stock.dto';
import { StockStatusFilter, type StockQueryDto, type StockSortField } from './dto/stock-query.dto';
import type { StockMovementQueryDto } from './dto/stock-movement-query.dto';

/** Movement types that add stock. Everything else removes it. */
const INBOUND_TYPES = new Set<StockMovementType>([
  StockMovementType.PURCHASE,
  StockMovementType.RETURN_IN,
  StockMovementType.ADJUSTMENT_IN,
  StockMovementType.REPAIR_IN,
]);

/** What a manual movement is attributed to, since it has no source document. */
const MANUAL_REFERENCE: Readonly<Record<ManualMovementType, StockReferenceType>> = {
  [StockMovementType.PURCHASE]: StockReferenceType.PURCHASE,
  [StockMovementType.ADJUSTMENT_IN]: StockReferenceType.MANUAL,
  [StockMovementType.ADJUSTMENT_OUT]: StockReferenceType.MANUAL,
};

/**
 * Sortable columns, mapped to the SQL they stand for.
 *
 * The listing is raw SQL, so the ORDER BY fragment cannot be a parameter. It is
 * taken from this table using a key the DTO has already restricted to a fixed
 * set, which is what makes interpolating it safe.
 */
const SORT_COLUMN: Readonly<Record<StockSortField, string>> = {
  sku: 'p."sku"',
  name: 'p."name"',
  quantity: 'i."quantity"',
  availableQuantity: '(i."quantity" - i."reservedQuantity")',
  minimumStock: 'p."minimumStock"',
  updatedAt: 'i."updatedAt"',
};

export type StockStatus = 'OK' | 'LOW' | 'OUT';

/** A product with its stock level, as returned by the stock listing. */
export interface StockLevel {
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string;
  categoryName: string;
  brandId: string | null;
  brandName: string | null;
  /** Exact decimal strings, matching the money contract everywhere else. */
  costPrice: string;
  sellingPrice: string;
  minimumStock: number;
  isActive: boolean;
  quantity: number;
  reservedQuantity: number;
  /** What can still be sold: on hand minus what is already committed. */
  availableQuantity: number;
  stockStatus: StockStatus;
  updatedAt: Date;
}

export interface StockSummary {
  totalProducts: number;
  totalUnits: number;
  /** On-hand quantity valued at cost, as an exact decimal string. */
  inventoryValueAtCost: string;
  inventoryValueAtRetail: string;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface StockAdjustmentResult {
  productId: string;
  sku: string;
  type: StockMovementType;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  movementId: string;
}

@Injectable()
export class StockService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Lists stock levels.
   *
   * Written as SQL because the interesting filter compares two columns from
   * two tables - `Inventory.quantity` against `Product.minimumStock` - which no
   * ORM filter API can express. Doing it in JavaScript would mean fetching
   * every product to answer one page, and would make `total` a lie.
   */
  async findAll(query: StockQueryDto): Promise<Paginated<StockLevel>> {
    const where = this.buildStockWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);
    const direction = Prisma.raw(query.sortOrder === 'asc' ? 'ASC' : 'DESC');
    const orderBy = Prisma.raw(SORT_COLUMN[query.sortBy]);

    const rows = await this.prisma.$queryRaw<StockLevelRow[]>`
      SELECT
        p."id"                                        AS "productId",
        p."sku",
        p."barcode",
        p."name",
        p."categoryId",
        c."name"                                      AS "categoryName",
        p."brandId",
        b."name"                                      AS "brandName",
        p."costPrice"::text                           AS "costPrice",
        p."sellingPrice"::text                        AS "sellingPrice",
        p."minimumStock",
        p."isActive",
        i."quantity",
        i."reservedQuantity",
        (i."quantity" - i."reservedQuantity")         AS "availableQuantity",
        CASE
          WHEN i."quantity" = 0 THEN 'OUT'
          WHEN i."quantity" <= p."minimumStock" THEN 'LOW'
          ELSE 'OK'
        END                                           AS "stockStatus",
        i."updatedAt"
      FROM "Inventory" i
      JOIN "Product" p ON p."id" = i."productId"
      JOIN "Category" c ON c."id" = p."categoryId"
      LEFT JOIN "Brand" b ON b."id" = p."brandId"
      WHERE ${where}
      ORDER BY ${orderBy} ${direction}, p."sku" ASC
      LIMIT ${take} OFFSET ${skip}
    `;

    const [counted] = await this.prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS "total"
      FROM "Inventory" i
      JOIN "Product" p ON p."id" = i."productId"
      WHERE ${where}
    `;

    return paginate(rows.map(toStockLevel), counted?.total ?? 0, query.page, query.limit);
  }

  async findOne(productId: string): Promise<StockLevel> {
    const page = await this.findAll({
      page: 1,
      limit: 1,
      sortBy: 'sku',
      sortOrder: 'asc',
      stockStatus: StockStatusFilter.ALL,
      productId,
    } as StockQueryDto & { productId: string });

    const level = page.items[0];

    if (level === undefined) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
    }

    return level;
  }

  /** Counts and valuations for the stock dashboard, computed in the database. */
  async summary(): Promise<StockSummary> {
    const [row] = await this.prisma.$queryRaw<StockSummaryRow[]>`
      SELECT
        COUNT(*)::int                                                                  AS "totalProducts",
        COALESCE(SUM(i."quantity"), 0)::int                                            AS "totalUnits",
        COALESCE(SUM(i."quantity" * p."costPrice"), 0)::numeric(14, 2)::text           AS "inventoryValueAtCost",
        COALESCE(SUM(i."quantity" * p."sellingPrice"), 0)::numeric(14, 2)::text        AS "inventoryValueAtRetail",
        COUNT(*) FILTER (WHERE i."quantity" > 0 AND i."quantity" <= p."minimumStock")::int AS "lowStockCount",
        COUNT(*) FILTER (WHERE i."quantity" = 0)::int                                  AS "outOfStockCount"
      FROM "Inventory" i
      JOIN "Product" p ON p."id" = i."productId"
      WHERE i."organizationId" = ${getCurrentOrgId()}::uuid AND p."deletedAt" IS NULL
    `;

    return (
      row ?? {
        totalProducts: 0,
        totalUnits: 0,
        inventoryValueAtCost: '0.00',
        inventoryValueAtRetail: '0.00',
        lowStockCount: 0,
        outOfStockCount: 0,
      }
    );
  }

  async findMovements(query: StockMovementQueryDto): Promise<Paginated<MovementWithContext>> {
    const where = buildMovementWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        include: MOVEMENT_INCLUDE,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip,
        take,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  /**
   * Applies a manual stock movement.
   *
   * The quantity change and its ledger entry are written in one transaction, so
   * stock can never move without a movement to explain it, and a movement can
   * never exist for a change that was rolled back.
   *
   * The change itself is a single conditional UPDATE rather than a read in
   * JavaScript followed by a write. Two simultaneous sales of the last unit
   * would both pass a JavaScript check and both write; here the second
   * statement blocks on the row lock, then re-evaluates its WHERE clause
   * against the value the first one committed, and matches no rows. The
   * database is the arbiter, and the `Inventory_quantity_non_negative` check
   * constraint is the backstop behind it.
   */
  async adjust(dto: AdjustStockDto, userId: string): Promise<StockAdjustmentResult> {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      select: { id: true, sku: true, deletedAt: true },
    });

    // `undefined !== null` is true, so a missing product throws here too.
    if (product?.deletedAt !== null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Product not found' });
    }

    const delta = INBOUND_TYPES.has(dto.type) ? dto.quantity : -dto.quantity;

    return this.prisma.$transaction(async (tx) => {
      // The guard is `quantity + delta >= reservedQuantity`, which covers both
      // rules at once: stock cannot go negative, and it cannot drop below what
      // is already committed to an order. Reserved quantity is never negative,
      // so a passing row satisfies both constraints.
      const affected = await tx.$executeRaw`
        UPDATE "Inventory"
        SET "quantity" = "quantity" + ${delta}, "updatedAt" = NOW()
        WHERE "productId" = ${dto.productId}::uuid
          AND "organizationId" = ${getCurrentOrgId()}::uuid
          AND "quantity" + ${delta} >= "reservedQuantity"
      `;

      if (affected === 0) {
        throw await this.explainRejectedAdjustment(tx, dto);
      }

      const inventory = await tx.inventory.findUniqueOrThrow({
        where: { productId: dto.productId },
        select: { quantity: true, reservedQuantity: true },
      });

      const movement = await tx.stockMovement.create({
        data: {
          organizationId: getCurrentOrgId(),
          productId: dto.productId,
          type: dto.type,
          quantity: dto.quantity,
          previousQuantity: inventory.quantity - delta,
          newQuantity: inventory.quantity,
          referenceType: MANUAL_REFERENCE[dto.type],
          note: dto.note ?? null,
          createdById: userId,
        },
        select: { id: true },
      });

      await this.auditService.record(
        {
          userId,
          action: AuditAction.STOCK_ADJUSTED,
          entity: AuditEntity.INVENTORY,
          entityId: dto.productId,
          metadata: { type: dto.type, quantity: dto.quantity, previousQuantity: inventory.quantity - delta, newQuantity: inventory.quantity },
        },
        tx,
      );

      return {
        productId: dto.productId,
        sku: product.sku,
        type: dto.type,
        quantity: dto.quantity,
        previousQuantity: inventory.quantity - delta,
        newQuantity: inventory.quantity,
        reservedQuantity: inventory.reservedQuantity,
        availableQuantity: inventory.quantity - inventory.reservedQuantity,
        movementId: movement.id,
      };
    });
  }

  /**
   * Turns "no rows matched" into an error the caller can act on. Reached only
   * on the failure path, so the extra read costs nothing in normal operation.
   */
  private async explainRejectedAdjustment(tx: TenantTransactionClient, dto: AdjustStockDto): Promise<ConflictException | NotFoundException> {
    const inventory = await tx.inventory.findUnique({
      where: { productId: dto.productId },
      select: { quantity: true, reservedQuantity: true },
    });

    if (inventory === null) {
      return new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'This product has no inventory record' });
    }

    const available = inventory.quantity - inventory.reservedQuantity;

    return new ConflictException({
      code: ErrorCode.CONFLICT,
      message: `Insufficient stock: ${String(dto.quantity)} requested but only ${String(available)} available (${String(inventory.quantity)} on hand, ${String(inventory.reservedQuantity)} reserved)`,
    });
  }

  private buildStockWhere(query: StockQueryDto & { productId?: string }): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`i."organizationId" = ${getCurrentOrgId()}::uuid`, Prisma.sql`p."deletedAt" IS NULL`];

    if (query.productId !== undefined) {
      conditions.push(Prisma.sql`p."id" = ${query.productId}::uuid`);
    }
    if (query.categoryId !== undefined) {
      conditions.push(Prisma.sql`p."categoryId" = ${query.categoryId}::uuid`);
    }
    if (query.brandId !== undefined) {
      conditions.push(Prisma.sql`p."brandId" = ${query.brandId}::uuid`);
    }
    if (query.isActive !== undefined) {
      conditions.push(Prisma.sql`p."isActive" = ${query.isActive}`);
    }

    switch (query.stockStatus) {
      case StockStatusFilter.OUT:
        conditions.push(Prisma.sql`i."quantity" = 0`);
        break;
      case StockStatusFilter.LOW:
        conditions.push(Prisma.sql`i."quantity" > 0 AND i."quantity" <= p."minimumStock"`);
        break;
      case StockStatusFilter.OK:
        conditions.push(Prisma.sql`i."quantity" > p."minimumStock"`);
        break;
      case StockStatusFilter.ALL:
        break;
    }

    // Every term must match somewhere, matching the behaviour of the other
    // list endpoints. Values stay parameters, so the pattern cannot inject SQL.
    const terms = query.search === undefined ? [] : query.search.split(/\s+/).filter((term) => term !== '');
    for (const term of terms) {
      const pattern = `%${term}%`;
      conditions.push(Prisma.sql`(p."sku" ILIKE ${pattern} OR p."name" ILIKE ${pattern} OR p."barcode" ILIKE ${pattern})`);
    }

    return Prisma.join(conditions, ' AND ');
  }
}

const MOVEMENT_INCLUDE = {
  product: { select: { id: true, sku: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export type MovementWithContext = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;

/** Raw rows arrive with numeric columns already cast to text in SQL. */
interface StockLevelRow extends Omit<StockLevel, 'stockStatus'> {
  stockStatus: string;
}

interface StockSummaryRow {
  totalProducts: number;
  totalUnits: number;
  inventoryValueAtCost: string;
  inventoryValueAtRetail: string;
  lowStockCount: number;
  outOfStockCount: number;
}

function toStockLevel(row: StockLevelRow): StockLevel {
  return { ...row, stockStatus: row.stockStatus === 'OUT' || row.stockStatus === 'LOW' ? row.stockStatus : 'OK' };
}

function buildMovementWhere(query: StockMovementQueryDto): Prisma.StockMovementWhereInput {
  return {
    ...(query.productId === undefined ? {} : { productId: query.productId }),
    ...(query.type === undefined ? {} : { type: query.type }),
    ...(query.referenceType === undefined ? {} : { referenceType: query.referenceType }),
    ...(query.createdById === undefined ? {} : { createdById: query.createdById }),
    ...(query.createdFrom === undefined && query.createdTo === undefined
      ? {}
      : {
          createdAt: {
            ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { lte: query.createdTo }),
          },
        }),
  };
}
