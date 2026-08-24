import { Prisma } from '../generated/prisma/client';
import type { AuditQueryDto } from './dto/audit-query.dto';

/** Who did it, when the actor still exists. Null for events with no session, such as a failed login. */
export const AUDIT_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

export type AuditLogWithActor = Prisma.AuditLogGetPayload<{ include: typeof AUDIT_INCLUDE }>;

export function buildAuditWhere(query: AuditQueryDto): Prisma.AuditLogWhereInput {
  return {
    ...(query.userId === undefined ? {} : { userId: query.userId }),
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.entity === undefined ? {} : { entity: query.entity }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
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
