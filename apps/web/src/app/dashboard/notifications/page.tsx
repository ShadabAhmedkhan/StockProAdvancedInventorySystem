'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/select';
import { notificationsApi } from '@/features/notifications/api';
import { NOTIFICATION_TYPE_LABELS } from '@/features/notifications/labels';
import type { Notification, NotificationType } from '@/features/notifications/types';
import { formatDateTime } from '@/lib/format';

const TYPES = Object.keys(NOTIFICATION_TYPE_LABELS) as NotificationType[];

export default function NotificationsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [type, setType] = useState<NotificationType | ''>('');
  const [readFilter, setReadFilter] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['notifications', page, type, readFilter],
    queryFn: () =>
      notificationsApi.list({
        page,
        type: type === '' ? undefined : type,
        isRead: readFilter === 'ALL' ? undefined : readFilter === 'READ',
      }),
  });

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] }),
    ]);
  };

  const columns: DataTableColumn<Notification>[] = [
    {
      key: 'title',
      label: 'Notification',
      render: (row) => (
        <div>
          <div className="flex items-center gap-2">
            {!row.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
            <span className="font-medium">{row.title}</span>
          </div>
          <p className="text-muted-foreground">{row.message}</p>
        </div>
      ),
    },
    { key: 'type', label: 'Type', render: (row) => NOTIFICATION_TYPE_LABELS[row.type] },
    { key: 'createdAt', label: 'When', render: (row) => <span className="text-muted-foreground">{formatDateTime(row.createdAt)}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (row) =>
        row.isRead ? null : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void notificationsApi.markRead(row.id).then(invalidate);
            }}
          >
            Mark read
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">Everything the system has flagged for you.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void notificationsApi.markAllRead().then(invalidate);
          }}
        >
          Mark all read
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={type}
          onChange={(event) => {
            setType(event.target.value as NotificationType | '');
            setPage(1);
          }}
          className="max-w-56"
        >
          <option value="">All types</option>
          {TYPES.map((value) => (
            <option key={value} value={value}>
              {NOTIFICATION_TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          value={readFilter}
          onChange={(event) => {
            setReadFilter(event.target.value as typeof readFilter);
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="ALL">All</option>
          <option value="UNREAD">Unread</option>
          <option value="READ">Read</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No notifications found."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />
    </div>
  );
}
