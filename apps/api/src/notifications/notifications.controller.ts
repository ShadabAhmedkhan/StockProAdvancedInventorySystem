import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import type { Notification } from '../generated/prisma/client';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationsService } from './notifications.service';

/** Every authenticated user reads and acknowledges only their own notifications - there is no cross-user write here. */
@ApiBearerAuth('access-token')
@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's notifications, newest first" })
  findAll(@Query() query: NotificationQueryDto, @CurrentUser() caller: AuthenticatedUser): Promise<Paginated<Notification>> {
    return this.notificationsService.findAll(caller.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: "The caller's unread notification count, for a nav badge" })
  unreadCount(@CurrentUser() caller: AuthenticatedUser): Promise<{ count: number }> {
    return this.notificationsService.unreadCount(caller.id).then((count) => ({ count }));
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one notification read' })
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() caller: AuthenticatedUser): Promise<Notification> {
    return this.notificationsService.markRead(id, caller.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark all of the caller's notifications read" })
  markAllRead(@CurrentUser() caller: AuthenticatedUser): Promise<{ count: number }> {
    return this.notificationsService.markAllRead(caller.id);
  }
}
