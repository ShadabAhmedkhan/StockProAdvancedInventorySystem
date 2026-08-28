'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Select } from '@/components/ui/select';
import { returnsApi } from '@/features/returns/api';
import { ReturnStatusBadge } from '@/features/returns/components/return-status-badge';
import { RETURN_REASON_LABELS, RETURN_STATUS_LABELS } from '@/features/returns/labels';
import type { ReturnReason, ReturnStatus } from '@/features/returns/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const RAISE_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);
const RETURN_STATUSES = Object.keys(RETURN_STATUS_LABELS) as ReturnStatus[];
const RETURN_REASONS = Object.keys(RETURN_REASON_LABELS) as ReturnReason[];

export default function ReturnsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canRaise = RAISE_ROLES.has(user?.role ?? '');
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ReturnStatus | ''>('');
  const [reason, setReason] = useState<ReturnReason | ''>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['returns', page, status, reason],
    queryFn: () => returnsApi.list({ page, status: status || undefined, reason: reason || undefined }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Returns</h1>
          <p className="text-sm text-muted-foreground">Goods coming back from completed orders.</p>
        </div>
        {canRaise && (
          <Button
            onClick={() => {
              router.push('/dashboard/returns/new');
            }}
          >
            Raise return
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ReturnStatus | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All statuses</option>
          {RETURN_STATUSES.map((value) => (
            <option key={value} value={value}>
              {RETURN_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          value={reason}
          onChange={(event) => {
            setReason(event.target.value as ReturnReason | '');
            setPage(1);
          }}
          className="max-w-44"
        >
          <option value="">All reasons</option>
          {RETURN_REASONS.map((value) => (
            <option key={value} value={value}>
              {RETURN_REASON_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <TableSkeleton />}
          {isError && <p className="p-4 text-sm text-danger">{errorMessage(error)}</p>}
          {data !== undefined && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Return #</th>
                    <th className="p-3 font-medium">Order</th>
                    <th className="p-3 font-medium">Customer</th>
                    <th className="p-3 font-medium">Reason</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 text-right font-medium">Refund</th>
                    <th className="p-3 font-medium">Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-muted-foreground">
                        No returns found.
                      </td>
                    </tr>
                  )}
                  {data.items.map((returnRecord) => (
                    <tr key={returnRecord.id} className="border-b border-border last:border-0 hover:bg-muted">
                      <td className="p-3">
                        <Link href={`/dashboard/returns/${returnRecord.id}`} className="font-medium hover:underline">
                          {returnRecord.returnNumber}
                        </Link>
                      </td>
                      <td className="p-3 text-muted-foreground">{returnRecord.order.orderNumber}</td>
                      <td className="p-3 text-muted-foreground">
                        {returnRecord.customer === null ? '-' : `${returnRecord.customer.firstName} ${returnRecord.customer.lastName}`}
                      </td>
                      <td className="p-3 text-muted-foreground">{RETURN_REASON_LABELS[returnRecord.reason]}</td>
                      <td className="p-3">
                        <ReturnStatusBadge status={returnRecord.status} />
                      </td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(returnRecord.refundAmount)}</td>
                      <td className="p-3 text-muted-foreground">{formatDateTime(returnRecord.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data !== undefined && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages} &middot; {data.pagination.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => {
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
