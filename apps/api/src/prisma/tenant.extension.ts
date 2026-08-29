import { getCurrentOrgId } from '../common/tenant/tenant-context';
import { Prisma } from '../generated/prisma/client';

/**
 * Every model that carries a required `organizationId` column, i.e. every
 * model a request-scoped query must never be allowed to read or write across
 * tenants. Deliberately an explicit allow-list, not "every model": a new
 * model must be added here on purpose, and the two kinds of model that are
 * NOT here - `AuditLog` (nullable org, written before a session may exist)
 * and everything parent-scoped (`OrderItem`, `RepairItem`, `ReturnItem`,
 * `RepairStatusHistory`, `RefreshToken`) or genuinely global (`Organization`)
 * - are excluded on purpose, not by omission.
 */
const TENANT_MODELS = new Set([
  'User',
  'Customer',
  'Supplier',
  'Category',
  'Brand',
  'Product',
  'Inventory',
  'StockMovement',
  'Order',
  'Repair',
  'Return',
  'Expense',
  'Payment',
  'FinancialTransaction',
  'Setting',
  'PurchaseOrder',
  'GoodsReceipt',
  'Location',
  'ProductUnit',
  'StockCount',
  'Notification',
  'AutomationRule',
]);

const READ_OR_MUTATE_BY_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

type PlainRecord = Record<string, unknown>;

function withOrgWhere(args: PlainRecord, organizationId: string): PlainRecord {
  const where = (args.where as PlainRecord | undefined) ?? {};
  return { ...args, where: { ...where, organizationId } };
}

/** Only calls `getCurrentOrgId()` (which throws outside a request) when the caller hasn't
 * already supplied one - registration creates the first user of a brand-new org before any
 * session/JWT exists, so it passes `organizationId` explicitly instead of relying on context. */
function withOrgData(data: PlainRecord): PlainRecord {
  if (typeof data.organizationId === 'string') {
    return data;
  }
  return { ...data, organizationId: getCurrentOrgId() };
}

/**
 * Auto-scopes every query against a `TENANT_MODELS` model to the current
 * request's organization, sourced from `tenant-context.ts`'s AsyncLocalStorage.
 * This is what makes ~180 existing Prisma call sites across the service layer
 * tenant-safe without editing each one by hand: as long as a service goes
 * through this extended client (which `PrismaService` now is), a forgotten
 * `where: { organizationId }` is not a cross-tenant leak, it's redundant.
 *
 * What this cannot reach: raw `$queryRaw`/`$executeRaw` call sites
 * (`reports.service.ts`, `stock-operations.ts`, `document-number.ts`) bypass
 * the query extension entirely and are scoped by hand instead.
 */
export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) {
          return query(args);
        }

        const scopedArgs: PlainRecord = args;

        if (READ_OR_MUTATE_BY_WHERE.has(operation)) {
          return query(withOrgWhere(scopedArgs, getCurrentOrgId()));
        }

        if (operation === 'create') {
          return query({ ...scopedArgs, data: withOrgData((scopedArgs.data as PlainRecord | undefined) ?? {}) });
        }

        if (operation === 'createMany' || operation === 'createManyAndReturn') {
          const rows = (scopedArgs.data as PlainRecord[] | undefined) ?? [];
          return query({ ...scopedArgs, data: rows.map((row) => withOrgData(row)) });
        }

        if (operation === 'upsert') {
          const organizationId = getCurrentOrgId();
          return query({
            ...scopedArgs,
            where: { ...((scopedArgs.where as PlainRecord | undefined) ?? {}), organizationId },
            create: withOrgData((scopedArgs.create as PlainRecord | undefined) ?? {}),
          } as typeof args);
        }

        return query(args);
      },
    },
  },
});
