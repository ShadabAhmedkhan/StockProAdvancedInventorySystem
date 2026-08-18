import { searchAcross } from '../common/pagination/search.util';
import { Prisma } from '../generated/prisma/client';
import type { RepairQueryDto } from './dto/repair-query.dto';
import { OPEN_REPAIR_STATUSES } from './repair-status';

/**
 * How repairs are read: what a workbench row carries, what a single repair
 * carries, and how a query narrows the set. Kept apart from the workflow so
 * the shape of a response can change without going near the rules that move
 * stock and money.
 */

const ZERO = new Prisma.Decimal(0);

export const REPAIR_SUMMARY_INCLUDE = {
  customer: { select: { id: true, customerCode: true, firstName: true, lastName: true, phone: true } },
  technician: { select: { id: true, firstName: true, lastName: true } },
  items: { select: { total: true } },
  payments: { select: { amount: true } },
} as const;

export const REPAIR_DETAIL_INCLUDE = {
  customer: { select: { id: true, customerCode: true, firstName: true, lastName: true, phone: true, email: true } },
  technician: { select: { id: true, firstName: true, lastName: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true } } }, orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { paidAt: 'asc' } },
  statusHistory: {
    include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  },
} as const;

type RepairSummaryRow = Prisma.RepairGetPayload<{ include: typeof REPAIR_SUMMARY_INCLUDE }>;
type RepairDetailRow = Prisma.RepairGetPayload<{ include: typeof REPAIR_DETAIL_INCLUDE }>;

/** Amounts a repair implies rather than stores, all exact decimals. */
export interface RepairAmounts {
  /** What the fitted parts came to. Informative: `finalCost` is the charge. */
  partsTotal: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  /** Null until `finalCost` is set: what is owed is not yet known. */
  outstanding: Prisma.Decimal | null;
}

export type RepairSummary = Omit<RepairSummaryRow, 'items' | 'payments'> & RepairAmounts & { partsCount: number };
export type RepairDetail = RepairDetailRow & RepairAmounts;

/**
 * Rolls the parts and the payments up.
 *
 * `partsTotal` is what the parts came to; it is deliberately not the charge.
 * A repair is priced by the shop - labour, diagnosis, goodwill - and that
 * judgement lives in `finalCost`, which is why completion insists on it rather
 * than quietly summing the parts.
 */
function amountsFor(
  items: readonly { total: Prisma.Decimal }[],
  payments: readonly { amount: Prisma.Decimal }[],
  finalCost: Prisma.Decimal | null,
): RepairAmounts {
  const partsTotal = items.reduce<Prisma.Decimal>((sum, item) => sum.add(item.total), ZERO);
  const paidAmount = payments.reduce<Prisma.Decimal>((sum, payment) => sum.add(payment.amount), ZERO);

  return { partsTotal, paidAmount, outstanding: finalCost === null ? null : finalCost.sub(paidAmount) };
}

/** The list drops the raw parts and payments it only loaded to add them up. */
export function toRepairSummary(row: RepairSummaryRow): RepairSummary {
  const { items, payments, ...repair } = row;

  return { ...repair, ...amountsFor(items, payments, repair.finalCost), partsCount: items.length };
}

export function toRepairDetail(row: RepairDetailRow): RepairDetail {
  return { ...row, ...amountsFor(row.items, row.payments, row.finalCost) };
}

/**
 * Columns a free-text search looks at. Module-owned, never caller-supplied.
 *
 * Serial number and IMEI are here because a customer who has lost their ticket
 * is identified by the device in their hand.
 */
const SEARCHABLE_FIELDS = ['repairNumber', 'serialNumber', 'imei', 'brand', 'model', 'problemDescription'] as const;

export function buildRepairWhere(query: RepairQueryDto, now: Date): Prisma.RepairWhereInput {
  // Where a shortcut and an explicit filter overlap, the explicit one wins:
  // `technicianId` beats `unassigned`, and `status` beats `openOnly`. A caller
  // who asked for something specific gets it rather than the broader shortcut.
  const assignment = query.technicianId !== undefined ? { technicianId: query.technicianId } : query.unassigned === true ? { technicianId: null } : {};

  const wantsOpen = query.openOnly === true || query.overdue === true;
  const status = query.status !== undefined ? { status: query.status } : wantsOpen ? { status: { in: [...OPEN_REPAIR_STATUSES] } } : {};

  // `lt` already excludes rows with no promised date, so no null check is needed.
  const late = query.overdue === true ? { expectedCompletionAt: { lt: now } } : {};

  const filters: Prisma.RepairWhereInput = {
    ...status,
    ...assignment,
    ...late,
    ...(query.deviceType === undefined ? {} : { deviceType: query.deviceType }),
    ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
    ...(query.receivedFrom === undefined && query.receivedTo === undefined
      ? {}
      : {
          receivedAt: {
            ...(query.receivedFrom === undefined ? {} : { gte: query.receivedFrom }),
            ...(query.receivedTo === undefined ? {} : { lte: query.receivedTo }),
          },
        }),
    ...(query.completedFrom === undefined && query.completedTo === undefined
      ? {}
      : {
          completedAt: {
            ...(query.completedFrom === undefined ? {} : { gte: query.completedFrom }),
            ...(query.completedTo === undefined ? {} : { lte: query.completedTo }),
          },
        }),
  };

  const search = searchAcross<Prisma.RepairWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
