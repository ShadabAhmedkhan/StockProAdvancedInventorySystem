'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ordersApi } from '@/features/orders/api';
import type { OrderSummary } from '@/features/orders/types';
import { OrderPicker } from '@/features/returns/components/order-picker';
import { RETURN_REASON_LABELS } from '@/features/returns/labels';
import { returnsApi, type CreateReturnItemInput } from '@/features/returns/api';
import type { ReturnReason } from '@/features/returns/types';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency } from '@/lib/format';

const REASONS = Object.keys(RETURN_REASON_LABELS) as ReturnReason[];

interface LineSelection {
  checked: boolean;
  quantity: string;
  restock: boolean;
}

export default function NewReturnPage(): React.JSX.Element {
  const router = useRouter();
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [reason, setReason] = useState<ReturnReason>('DAMAGED');
  const [reasonNote, setReasonNote] = useState('');
  const [lines, setLines] = useState<Record<string, LineSelection>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const orderDetailQuery = useQuery({
    queryKey: ['order-detail-for-return', order?.id],
    queryFn: () => ordersApi.get(order?.id ?? ''),
    enabled: order !== null,
  });

  function toggleLine(itemId: string, maxQuantity: number, checked: boolean): void {
    setLines((current) => {
      const existing = current[itemId] ?? { checked: false, quantity: String(maxQuantity), restock: true };
      return { ...current, [itemId]: { ...existing, checked } };
    });
  }

  function updateLine(itemId: string, patch: Partial<LineSelection>): void {
    setLines((current) => {
      const existing = current[itemId];
      if (existing === undefined) return current;
      return { ...current, [itemId]: { ...existing, ...patch } };
    });
  }

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (order === null) {
      setError('Choose the order these goods were sold on.');
      return;
    }
    const items: CreateReturnItemInput[] = Object.entries(lines)
      .filter(([, line]) => line.checked)
      .map(([orderItemId, line]) => ({ orderItemId, quantity: Number(line.quantity), restock: line.restock }));
    if (items.length === 0) {
      setError('Select at least one item to return.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const created = await returnsApi.create({ orderId: order.id, reason, reasonNote: reasonNote.trim() === '' ? undefined : reasonNote, items });
      toast.success('Return created');
      router.push(`/dashboard/returns/${created.id}`);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  const orderDetail = orderDetailQuery.data;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Raise a return</h1>
        <p className="text-sm text-muted-foreground">Take goods back against a completed order.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label>Order *</Label>
              {order === null ? (
                <OrderPicker
                  onSelect={(selected) => {
                    setOrder(selected);
                    setLines({});
                  }}
                />
              ) : (
                <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <span>
                    {order.orderNumber} &middot; {formatCurrency(order.total)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOrder(null);
                      setLines({});
                    }}
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>

            {order !== null && orderDetailQuery.isLoading && <p className="text-sm text-muted-foreground">Loading order lines...</p>}

            {orderDetail !== undefined && (
              <div className="space-y-1.5">
                <Label>Items to return *</Label>
                <div className="divide-y divide-border rounded-md border border-border">
                  {orderDetail.items.map((item) => {
                    const line = lines[item.id] ?? { checked: false, quantity: String(item.quantity), restock: true };
                    return (
                      <div key={item.id} className="flex flex-wrap items-center gap-3 p-2 text-sm">
                        <input
                          type="checkbox"
                          checked={line.checked}
                          onChange={(event) => {
                            toggleLine(item.id, item.quantity, event.target.checked);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          {item.product.name} <span className="text-xs text-muted-foreground">({item.product.sku})</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          sold {item.quantity} &middot; {formatCurrency(item.unitPrice)} each
                        </span>
                        {line.checked && (
                          <>
                            <Input
                              type="number"
                              min={1}
                              max={item.quantity}
                              value={line.quantity}
                              onChange={(event) => {
                                updateLine(item.id, { quantity: event.target.value });
                              }}
                              className="w-20"
                            />
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={line.restock}
                                onChange={(event) => {
                                  updateLine(item.id, { restock: event.target.checked });
                                }}
                              />
                              Restock
                            </label>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason *</Label>
              <Select
                id="reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value as ReturnReason);
                }}
              >
                {REASONS.map((value) => (
                  <option key={value} value={value}>
                    {RETURN_REASON_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason-note">Notes</Label>
              <Textarea
                id="reason-note"
                value={reasonNote}
                onChange={(event) => {
                  setReasonNote(event.target.value);
                }}
              />
            </div>

            {error !== null && <p className="text-sm text-danger">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  router.push('/dashboard/returns');
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Raising...' : 'Raise return'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
