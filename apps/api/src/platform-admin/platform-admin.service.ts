import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../common/enums/error-code.enum';
import { AuditAction, AuditEntity, SubscriptionStatus, type UserRole, type UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformOrganizationSummary {
  id: string;
  name: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: Date | null;
  createdAt: Date;
  userCount: number;
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

/**
 * Reads and manages tenants for the platform operator. Deliberately queries
 * only `Organization` and `User`'s identity columns - never a business table
 * (`Product`, `Order`, ...) - so this module structurally cannot become a
 * backdoor into a tenant's actual data, only into who the tenant is and
 * whether it can log in.
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
    const organizations = await this.prisma.organization.findMany({
      select: { id: true, name: true, subscriptionStatus: true, trialEndsAt: true, createdAt: true, _count: { select: { users: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return organizations.map(({ _count, ...organization }) => ({ ...organization, userCount: _count.users }));
  }

  async listOrganizationUsers(organizationId: string): Promise<PlatformOrganizationUser[]> {
    await this.requireOrganization(organizationId);

    return this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, status: true, lastLoginAt: true },
      orderBy: { createdAt: 'asc' },
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

  private async setStatus(organizationId: string, subscriptionStatus: SubscriptionStatus, actorEmail: string): Promise<PlatformOrganizationSummary> {
    await this.requireOrganization(organizationId);

    const { _count, ...organization } = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { subscriptionStatus },
      select: { id: true, name: true, subscriptionStatus: true, trialEndsAt: true, createdAt: true, _count: { select: { users: true } } },
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

    return { ...organization, userCount: _count.users };
  }

  private async requireOrganization(organizationId: string): Promise<{ trialEndsAt: Date | null }> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { trialEndsAt: true } });

    if (organization === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Organization not found' });
    }

    return organization;
  }
}
