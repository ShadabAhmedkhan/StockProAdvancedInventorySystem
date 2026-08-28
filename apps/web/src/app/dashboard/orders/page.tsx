'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ordersApi } from '@/features/orders/api';
import { OrderStatusBadge, PaymentStatusBadge } from '@/features/orders/components/order-status-badge';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/features/orders/labels';
import type { OrderStatus, OrderSummary, PaymentStatus } from '@/features/orders/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const SELL_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);
const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];
const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUS_LABELS) as PaymentStatus[];

export default function OrdersPage(): React.JSX.Element {
  const { user } = useAuth();
  const canSell = SELL_ROLES.has(user?.role ?? '');
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>('');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['orders', page, search, status, paymentStatus],
    queryFn: () => ordersApi.list({ page, search, status: status || undefined, paymentStatus: paymentStatus || undefined }),
  });

  const createMutation = useMutation({ mutationFn: ordersApi.create });

  async function handleNewSale(): Promise<void> {
    setCreateError(null);
    try {
      const order = await createMutation.mutateAsync({});
      router.push(`/dashboard/orders/${order.id}`);
    } catch (submitError) {
      setCreateError(errorMessage(submitError));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Orders</h1>
          <p className="text-sm text-muted-foreground">Sales, drafted through to completion.</p>
        </div>
        {canSell && (
          <Button
            disabled={createMutation.isPending}
            onClick={() => {
              void handleNewSale();
            }}
          >
            {createMutation.isPending ? 'Starting...' : 'New sale'}
          </Button>
        )}
      </div>

      {createError !== null && <p className="text-sm text-danger">{createError}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by order number or notes"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as OrderStatus | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ORDER_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          value={paymentStatus}
          onChange={(event) => {
            setPaymentStatus(event.target.value as PaymentStatus | '');
            setPage(1);
          }}
          className="max-w-40"
        >
          <option value="">All payment states</option>
          {PAYMENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PAYMENT_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={ORDER_COLUMNS}
        rows={data?.items ?? []}
        rowKey={(order) => order.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        emptyMessage="No orders found."
        onRowClick={(order) => {
          router.push(`/dashboard/orders/${order.id}`);
        }}
        pagination={
          data === undefined
            ? undefined
            : { page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total, onPageChange: setPage }
        }
      />
    </div>
  );
}

const ORDER_COLUMNS: DataTableColumn<OrderSummary>[] = [
  { key: 'orderNumber', label: 'Order', render: (order) => <span className="font-medium">{order.orderNumber}</span> },
  {
    key: 'customer',
    label: 'Customer',
    render: (order) => (
      <span className="text-muted-foreground">{order.customer === null ? 'Walk-in' : `${order.customer.firstName} ${order.customer.lastName}`}</span>
    ),
  },
  { key: 'status', label: 'Status', render: (order) => <OrderStatusBadge status={order.status} /> },
  { key: 'payment', label: 'Payment', render: (order) => <PaymentStatusBadge status={order.paymentStatus} /> },
  { key: 'items', label: 'Items', align: 'right', render: (order) => <span className="tabular-nums">{order._count.items}</span> },
  { key: 'total', label: 'Total', align: 'right', render: (order) => <span className="tabular-nums">{formatCurrency(order.total)}</span> },
  { key: 'outstanding', label: 'Outstanding', align: 'right', render: (order) => <span className="tabular-nums">{formatCurrency(order.outstanding)}</span> },
  { key: 'created', label: 'Created', render: (order) => <span className="text-muted-foreground">{formatDateTime(order.createdAt)}</span> },
];
