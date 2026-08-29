import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, RepairStatus, SubscriptionStatus, UserRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { notify } from './notify';

const CLOSED_REPAIR_STATUSES: RepairStatus[] = [RepairStatus.COMPLETED, RepairStatus.DELIVERED, RepairStatus.CANCELLED];
const TRIAL_WARNING_WINDOW_DAYS = 3;

/**
 * The two notification events with no natural code path to trigger from - a
 * repair going overdue and a trial approaching its end are both facts about
 * the passage of time, not something a user action does. Runs across every
 * organization with the plain (non-tenant-scoped) client, the same way
 * `BillingService`'s webhook handler does.
 */
@Injectable()
export class NotificationsScheduler {
  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkOverdueRepairs(): Promise<void> {
    const overdue = await this.prisma.repair.findMany({
      where: { expectedCompletionAt: { lt: new Date() }, status: { notIn: CLOSED_REPAIR_STATUSES } },
      select: { id: true, organizationId: true, repairNumber: true, technicianId: true },
    });

    for (const repair of overdue) {
      // Fires once per repair, not once per day it stays overdue - a repeated
      // daily nag for the same device would just get tuned out.
      const alreadyNotified = await this.prisma.notification.findFirst({
        where: { type: NotificationType.REPAIR_OVERDUE, entityType: 'REPAIR', entityId: repair.id },
        select: { id: true },
      });
      if (alreadyNotified !== null) {
        continue;
      }

      await notify(this.prisma, {
        organizationId: repair.organizationId,
        type: NotificationType.REPAIR_OVERDUE,
        title: 'Repair overdue',
        message: `Repair ${repair.repairNumber} is past its expected completion date`,
        entityType: 'REPAIR',
        entityId: repair.id,
        extraUserIds: repair.technicianId === null ? [] : [repair.technicianId],
      });
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkExpiringTrials(): Promise<void> {
    const warnBy = new Date();
    warnBy.setDate(warnBy.getDate() + TRIAL_WARNING_WINDOW_DAYS);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const expiring = await this.prisma.organization.findMany({
      where: { subscriptionStatus: SubscriptionStatus.TRIALING, trialEndsAt: { not: null, lte: warnBy, gte: new Date() } },
      select: { id: true, trialEndsAt: true },
    });

    for (const org of expiring) {
      // One reminder per calendar day, since this job itself only runs once a day anyway -
      // this guard only matters if it is ever also triggered manually on the same day.
      const alreadyNotifiedToday = await this.prisma.notification.findFirst({
        where: { organizationId: org.id, type: NotificationType.TRIAL_EXPIRING, createdAt: { gte: startOfToday } },
        select: { id: true },
      });
      if (alreadyNotifiedToday !== null) {
        continue;
      }

      await notify(this.prisma, {
        organizationId: org.id,
        type: NotificationType.TRIAL_EXPIRING,
        title: 'Trial ending soon',
        message: `Your trial ends on ${org.trialEndsAt?.toDateString() ?? 'soon'} - add billing details to keep access`,
        roles: [UserRole.ADMIN],
      });
    }
  }
}
