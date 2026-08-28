'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/select';
import { returnsApi } from '@/features/returns/api';
import { ReturnStatusBadge } from '@/features/returns/components/return-status-badge';
import { RETURN_REASON_LABELS, RETURN_STATUS_LABELS } from '@/features/returns/labels';
import type { ReturnReason, ReturnStatus, ReturnSummary } from '@/features/returns/types';
import { useAuth } from '@/hooks/use-auth';
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

      <DataTable
        columns={RETURN_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(returnRecord) => returnRecord.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No returns found."
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />
    </div>
  );
}

const RETURN_COLUMNS: DataTableColumn<ReturnSummary>[] = [
  {
    key: 'returnNumber',
    label: 'Return #',
    render: (returnRecord) => (
      <Link href={`/dashboard/returns/${returnRecord.id}`} className="font-medium hover:underline">
        {returnRecord.returnNumber}
      </Link>
    ),
  },
  { key: 'order', label: 'Order', render: (returnRecord) => <span className="text-muted-foreground">{returnRecord.order.orderNumber}</span> },
  {
    key: 'customer',
    label: 'Customer',
    render: (returnRecord) => (
      <span className="text-muted-foreground">
        {returnRecord.customer === null ? '-' : `${returnRecord.customer.firstName} ${returnRecord.customer.lastName}`}
      </span>
    ),
  },
  { key: 'reason', label: 'Reason', render: (returnRecord) => <span className="text-muted-foreground">{RETURN_REASON_LABELS[returnRecord.reason]}</span> },
  { key: 'status', label: 'Status', render: (returnRecord) => <ReturnStatusBadge status={returnRecord.status} /> },
  { key: 'refund', label: 'Refund', align: 'right', render: (returnRecord) => <span className="tabular-nums">{formatCurrency(returnRecord.refundAmount)}</span> },
  { key: 'raised', label: 'Raised', render: (returnRecord) => <span className="text-muted-foreground">{formatDateTime(returnRecord.createdAt)}</span> },
];
