import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../common/enums/error-code.enum';
import type { Prisma } from '../generated/prisma/client';
import { AuditAction, AuditEntity, SubscriptionStatus, type UserRole, type UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  createdAt: Date;
  userCount: number;
  /** The most recent login by any of the org's users - whether the tenant is actually using the product. */
  lastLoginAt: Date | null;
}

export interface PlatformOrganizationUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
}

export interface PlatformOrganizationActivity {
  id: string;
  action: AuditAction;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

const ACTIVITY_LIMIT = 50;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  subscriptionStatus: true,
  trialEndsAt: true,
  createdAt: true,
  _count: { select: { users: true } },
  users: { select: { lastLoginAt: true }, where: { lastLoginAt: { not: null } }, orderBy: { lastLoginAt: 'desc' }, take: 1 },
} as const satisfies Prisma.OrganizationSelect;

type OrganizationSummaryRow = Prisma.OrganizationGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toSummary({ _count, users, ...organization }: OrganizationSummaryRow): PlatformOrganizationSummary {
  return { ...organization, userCount: _count.users, lastLoginAt: users[0]?.lastLoginAt ?? null };
}

/**
 * Reads and manages tenants for the platform operator. Deliberately queries
 * only `Organization`, `User`'s identity columns and the operator's own
 * `ORGANIZATION` audit entries - never a business table (`Product`,
 * `Order`, ...) - so this module structurally cannot become a backdoor into a
 * tenant's actual data, only into who the tenant is and whether it can log in.
 *
 * Uses the plain, non-tenant-scoped `PrismaService`: a platform-admin request
 * has no `AsyncLocalStorage` tenant context (see `PlatformAdminAuthGuard`),
 * so the tenant-extended client has nothing to scope by and would throw.
 */
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listOrganizations(): Promise<PlatformOrganizationSummary[]> {
    const organizations = await this.prisma.organization.findMany({ select: SUMMARY_SELECT, orderBy: { createdAt: 'desc' } });

    return organizations.map(toSummary);
  }

  async listOrganizationUsers(organizationId: string): Promise<PlatformOrganizationUser[]> {
    await this.requireOrganization(organizationId);

    return this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, lastLoginAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * The operator's own actions against this org (suspensions, reactivations,
   * trial extensions), newest first. `ORGANIZATION` entries are only ever
   * written by this module, so this never surfaces a tenant's own activity.
   */
  async listOrganizationActivity(organizationId: string): Promise<PlatformOrganizationActivity[]> {
    await this.requireOrganization(organizationId);

    return this.prisma.auditLog.findMany({
      where: { entity: AuditEntity.ORGANIZATION, entityId: organizationId },
      select: { id: true, action: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_LIMIT,
    });
  }

  async suspend(organizationId: string, actorEmail: string): Promise<PlatformOrganizationSummary> {
    return this.setStatus(organizationId, SubscriptionStatus.SUSPENDED, actorEmail);
  }

  /**
   * Restores access. Not a blind reset to `ACTIVE`: an org still inside its
   * trial window should come back trialing, not silently marked as if it had
   * paid.
   */
  async reactivate(organizationId: string, actorEmail: string): Promise<PlatformOrganizationSummary> {
    const organization = await this.requireOrganization(organizationId);
    const stillTrialing = organization.trialEndsAt !== null && organization.trialEndsAt.getTime() > Date.now();

    return this.setStatus(organizationId, stillTrialing ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE, actorEmail);
  }

  /**
   * Pushes the trial end out by `days`, counted from whichever is later - the
   * current end or now - so a lapsed trial restarts from today rather than
   * being extended to a date that has already passed.
   *
   * One conditional UPDATE computes the new date from the committed row, so
   * two extensions landing together both count instead of one overwriting the
   * other. A paying (`ACTIVE`) org is refused: flipping it back to `TRIALING`
   * would quietly drop it out of paid status. A `SUSPENDED` org stays
   * suspended - only the date moves, and `reactivate` then brings it back
   * trialing.
   */
  async extendTrial(organizationId: string, days: number, actorEmail: string): Promise<PlatformOrganizationSummary> {
    return this.prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRaw`
        UPDATE "Organization"
        SET "trialEndsAt" = GREATEST("trialEndsAt", NOW() AT TIME ZONE 'UTC') + make_interval(days => ${days}::int),
            "subscriptionStatus" = CASE WHEN "subscriptionStatus" = 'SUSPENDED' THEN "subscriptionStatus" ELSE 'TRIALING' END,
            "updatedAt" = NOW()
        WHERE "id" = ${organizationId}::uuid
          AND "subscriptionStatus" <> 'ACTIVE'
      `;

      if (affected === 0) {
        await this.requireOrganization(organizationId);
        throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'This organization is on an active paid subscription - there is no trial to extend' });
      }

      const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: SUMMARY_SELECT });

      await this.auditService.record(
        {
          organizationId,
          userId: null,
          action: AuditAction.UPDATE,
          entity: AuditEntity.ORGANIZATION,
          entityId: organizationId,
          metadata: {
            trialEndsAt: organization.trialEndsAt?.toISOString() ?? null,
            extendedByDays: days,
            subscriptionStatus: organization.subscriptionStatus,
            actor: actorEmail,
          },
        },
        tx,
      );

      return toSummary(organization);
    });
  }

  private async setStatus(organizationId: string, subscriptionStatus: SubscriptionStatus, actorEmail: string): Promise<PlatformOrganizationSummary> {
    await this.requireOrganization(organizationId);

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { subscriptionStatus },
      select: SUMMARY_SELECT,
    });

    await this.auditService.record(
      {
        organizationId,
        userId: null,
        action: AuditAction.STATUS_CHANGED,
        entity: AuditEntity.ORGANIZATION,
        entityId: organizationId,
        metadata: { subscriptionStatus, actor: actorEmail },
      },
      this.prisma,
    );

    return toSummary(organization);
  }

  private async requireOrganization(organizationId: string): Promise<{ trialEndsAt: Date | null }> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { trialEndsAt: true } });

    if (organization === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Organization not found' });
    }

    return organization;
  }
}
