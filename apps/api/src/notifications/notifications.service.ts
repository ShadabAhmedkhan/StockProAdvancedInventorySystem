import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import type { Notification, Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { NotificationQueryDto } from './dto/notification-query.dto';

/** Reads and acknowledgements for the current user's own notifications. Writing a new one is `notify()` (`notify.ts`), called by the module where the event happened. */
@Injectable()
export class NotificationsService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

  async findAll(userId: string, query: NotificationQueryDto): Promise<Paginated<Notification>> {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.type !== undefined && { type: query.type }),
      ...(query.isRead !== undefined && { isRead: query.isRead }),
    };
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.notification.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    // A conditional UPDATE keyed on userId, not a find-then-update: the row belongs to
    // exactly one user, so this is what stops one user marking another's notification read.
    const affected = await this.prisma.notification.updateMany({
      where: { id, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    if (affected.count === 0) {
      const exists = await this.prisma.notification.findUnique({ where: { id, userId }, select: { id: true } });
      if (exists === null) {
        throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Notification not found' });
      }
      // Already read - idempotent, not an error.
    }

    return this.prisma.notification.findUniqueOrThrow({ where: { id, userId } });
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return { count: result.count };
  }
}
