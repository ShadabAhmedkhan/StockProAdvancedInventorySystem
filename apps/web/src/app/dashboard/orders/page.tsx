'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ordersApi } from '@/features/orders/api';
import { OrderStatusBadge, PaymentStatusBadge } from '@/features/orders/components/order-status-badge';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/features/orders/labels';
import type { OrderStatus, PaymentStatus } from '@/features/orders/types';
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

      <Card>
        <CardContent className="p-0">
          {isLoading && <TableSkeleton />}
          {isError && <p className="p-4 text-sm text-danger">{errorMessage(error)}</p>}
          {data !== undefined && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Order</th>
                    <th className="p-3 font-medium">Customer</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Payment</th>
                    <th className="p-3 text-right font-medium">Items</th>
                    <th className="p-3 text-right font-medium">Total</th>
                    <th className="p-3 text-right font-medium">Outstanding</th>
                    <th className="p-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-muted-foreground">
                        No orders found.
                      </td>
                    </tr>
                  )}
                  {data.items.map((order) => (
                    <tr
                      key={order.id}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted"
                      onClick={() => {
                        router.push(`/dashboard/orders/${order.id}`);
                      }}
                    >
                      <td className="p-3 font-medium">{order.orderNumber}</td>
                      <td className="p-3 text-muted-foreground">
                        {order.customer === null ? 'Walk-in' : `${order.customer.firstName} ${order.customer.lastName}`}
                      </td>
                      <td className="p-3">
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="p-3">
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </td>
                      <td className="p-3 text-right tabular-nums">{order._count.items}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(order.total)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(order.outstanding)}</td>
                      <td className="p-3 text-muted-foreground">{formatDateTime(order.createdAt)}</td>
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
