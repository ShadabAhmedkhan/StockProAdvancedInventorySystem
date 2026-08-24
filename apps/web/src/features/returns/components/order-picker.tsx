'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ordersApi } from '@/features/orders/api';
import type { OrderSummary } from '@/features/orders/types';
import { formatCurrency, formatDateTime } from '@/lib/format';

interface OrderPickerProps {
  onSelect: (order: OrderSummary) => void;
}

/** Only completed orders have anything to return. */
export function OrderPicker({ onSelect }: OrderPickerProps): React.JSX.Element {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(input);
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [input]);

  const { data } = useQuery({
    queryKey: ['order-picker', search],
    queryFn: () => ordersApi.list({ page: 1, search, status: 'COMPLETED' }),
    enabled: search.trim() !== '',
  });

  const results = data?.items ?? [];

  return (
    <div className="relative">
      <Input
        placeholder="Search completed orders by order number"
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
        }}
      />
      {search.trim() !== '' && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-md">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No matching completed orders.</p>
          ) : (
            results.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => {
                  onSelect(order);
                  setInput('');
                  setSearch('');
                }}
                className="flex w-full items-center justify-between gap-3 border-b border-border p-2 text-left text-sm last:border-0 hover:bg-muted"
              >
                <span className="font-medium">{order.orderNumber}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatCurrency(order.total)} &middot; {order.completedAt === null ? '' : formatDateTime(order.completedAt)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
