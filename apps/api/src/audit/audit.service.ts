import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { Prisma } from '../generated/prisma/client';
import type { AuditAction, AuditEntity } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_INCLUDE, buildAuditWhere, type AuditLogWithActor } from './audit-views';
import type { AuditQueryDto } from './dto/audit-query.dto';

/**
 * What happened, told to `record()` by the module where it happened.
 *
 * `userId` is `null` for an event with no authenticated actor, such as a
 * failed login. `metadata` is business context only - never a password, a
 * JWT, a refresh token, or anything else that would turn the trail itself
 * into a secret.
 */
export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * The append-only trail every other module writes into.
 *
 * `record()` takes an optional transaction client so a caller already inside
 * one can write the log entry atomically with the change it describes: if
 * the transaction rolls back, no orphaned entry claims something happened
 * that did not.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? Prisma.JsonNull,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  async findAll(query: AuditQueryDto): Promise<Paginated<AuditLogWithActor>> {
    const where = buildAuditWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, include: AUDIT_INCLUDE, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<AuditLogWithActor> {
    const entry = await this.prisma.auditLog.findUnique({ where: { id }, include: AUDIT_INCLUDE });

    if (entry === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Audit entry not found' });
    }

    return entry;
  }
}
