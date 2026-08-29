'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { notificationsApi } from '@/features/notifications/api';
import { NOTIFICATION_TYPE_LABELS } from '@/features/notifications/labels';
import { formatDateTime } from '@/lib/format';

const POLL_INTERVAL_MS = 30_000;

/** Unread count badge plus a dropdown of the most recent notifications - the "notification dropdown" the spec calls for. Full history/filters live at `/dashboard/notifications`. */
export function NotificationBell(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: recent } = useQuery({
    queryKey: ['notifications-recent'],
    queryFn: () => notificationsApi.list({ page: 1 }),
    enabled: open,
  });

  useEffect(() => {
    function handleClick(event: MouseEvent): void {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
    };
  }, []);

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
  };

  const count = unread?.count ?? 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-border bg-background shadow-md">
          <div className="flex items-center justify-between border-b border-border p-3">
            <p className="text-sm font-medium">Notifications</p>
            {count > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  void notificationsApi.markAllRead().then(invalidate);
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {recent === undefined || recent.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              recent.items.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    if (!notification.isRead) {
                      void notificationsApi.markRead(notification.id).then(invalidate);
                    }
                  }}
                  className={`block w-full border-b border-border p-3 text-left text-sm last:border-0 hover:bg-muted ${notification.isRead ? '' : 'bg-muted/50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{notification.title}</span>
                    {!notification.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{notification.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {NOTIFICATION_TYPE_LABELS[notification.type]} &middot; {formatDateTime(notification.createdAt)}
                  </p>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-border p-2 text-center">
            <Link
              href="/dashboard/notifications"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                setOpen(false);
              }}
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

