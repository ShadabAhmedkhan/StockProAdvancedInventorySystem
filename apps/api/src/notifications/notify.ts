import { UserRole, type NotificationType } from '../generated/prisma/enums';

/**
 * The two calls `notify()` makes, and nothing else about the client - a
 * request's `tx`, the plain `PrismaService`, and a cron's own transaction all
 * satisfy this structurally. Deliberately not a union of the real Prisma
 * client types: `Prisma.TransactionClient | TenantTransactionClient |
 * PrismaService` blows up the type checker ("Excessive stack depth") once
 * combined with this file's own client type in a caller that already unions
 * two of those three, because comparing the full generated delegate overloads
 * for every model is combinatorial. A two-method structural interface sidesteps
 * that entirely: assignability only has to check these two shapes, not the client.
 */
export interface NotifyClient {
  user: {
    findMany(args: { where: { organizationId: string; role: { in: UserRole[] }; status: 'ACTIVE' }; select: { id: true } }): Promise<{ id: string }[]>;
  };
  notification: {
    createMany(args: { data: NotificationCreateInput[] }): Promise<unknown>;
  };
}

interface NotificationCreateInput {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
}

export interface NotifyInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** e.g. entityType "REPAIR" + entityId the repair's id, so the UI can link to the record. */
  entityType?: string;
  entityId?: string;
  /** Who gets it beyond the default ADMIN/MANAGER audience - e.g. the technician assigned to a repair. */
  extraUserIds?: string[];
  /** Overrides the default ADMIN/MANAGER audience entirely. */
  roles?: UserRole[];
}

const DEFAULT_ROLES = [UserRole.ADMIN, UserRole.MANAGER];

/**
 * Writes one Notification row per recipient for a business event.
 *
 * Deliberately a plain function, not a service: it is called from every kind
 * of context this app has - inside a request's transaction (order/repair/PO
 * services), from a Stripe webhook with no request at all (billing), and from
 * a cron job iterating every organization (trial/overdue checks) - and a
 * plain function taking whatever client the caller already has is simpler
 * than DI-injecting a service into contexts that were never going to have a
 * request scope. Mirrors `stock-operations.ts`'s style for the same reason.
 */
export async function notify(client: NotifyClient, input: NotifyInput): Promise<void> {
  const roles = input.roles ?? DEFAULT_ROLES;

  const roleUsers = await client.user.findMany({
    where: { organizationId: input.organizationId, role: { in: roles }, status: 'ACTIVE' },
    select: { id: true },
  });

  const recipientIds = new Set(roleUsers.map((user) => user.id));
  for (const userId of input.extraUserIds ?? []) {
    recipientIds.add(userId);
  }

  if (recipientIds.size === 0) {
    return;
  }

  await client.notification.createMany({
    data: [...recipientIds].map((userId) => ({
      organizationId: input.organizationId,
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    })),
  });
}
