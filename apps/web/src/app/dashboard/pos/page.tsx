'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddPaymentDialog } from '@/features/orders/components/add-payment-dialog';
import { CustomerPicker } from '@/features/orders/components/customer-picker';
import { ProductPicker } from '@/features/orders/components/product-picker';
import { ordersApi } from '@/features/orders/api';
import { PAYMENT_METHOD_LABELS } from '@/features/orders/labels';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

/**
 * Fast checkout: scan/search -> cart -> customer -> discount -> payment -> receipt,
 * built entirely on the existing Order/Payment domain (no second sales ledger).
 * A held sale is simply a draft order left unfinished - closing this page loses
 * nothing, it just drops back into "Resume a held sale" below.
 */
export default function PosPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const heldQuery = useQuery({
    queryKey: ['pos-held-orders'],
    queryFn: () => ordersApi.list({ page: 1, search: '', status: 'DRAFT' }),
    enabled: activeOrderId === null,
  });

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', activeOrderId],
    queryFn: () => ordersApi.get(activeOrderId ?? ''),
    enabled: activeOrderId !== null,
  });

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['order', activeOrderId] }),
      queryClient.invalidateQueries({ queryKey: ['pos-held-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-summary'] }),
    ]);
  };

  const startSaleMutation = useMutation({ mutationFn: () => ordersApi.create({}) });
  const addItemMutation = useMutation({
    mutationFn: (productId: string) => ordersApi.addItem(activeOrderId ?? '', { productId, quantity: 1 }),
  });
  const removeItemMutation = useMutation({ mutationFn: (itemId: string) => ordersApi.removeItem(activeOrderId ?? '', itemId) });
  const updateHeaderMutation = useMutation({
    mutationFn: (input: { customerId?: string; discount?: string }) => ordersApi.update(activeOrderId ?? '', input),
  });
  const confirmMutation = useMutation({ mutationFn: () => ordersApi.confirm(activeOrderId ?? '') });
  const cancelMutation = useMutation({ mutationFn: () => ordersApi.cancel(activeOrderId ?? '') });

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await invalidate();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function handleStartSale(): Promise<void> {
    setActionError(null);
    try {
      const created = await startSaleMutation.mutateAsync();
      setActiveOrderId(created.id);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function handleCharge(): Promise<void> {
    if (order === undefined) return;
    setActionError(null);
    try {
      if (order.status === 'DRAFT') {
        await confirmMutation.mutateAsync();
        await invalidate();
      }
      setPaymentDialogOpen(true);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function handleNewSale(): void {
    setActiveOrderId(null);
    setPaymentDialogOpen(false);
    void queryClient.invalidateQueries({ queryKey: ['pos-held-orders'] });
  }

  // Held sale list: not yet in a sale.
  if (activeOrderId === null) {
    const held = heldQuery.data?.items ?? [];
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Point of sale</h1>
          <p className="text-sm text-muted-foreground">Start a new sale or resume a held one.</p>
        </div>

        {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

        <Button size="lg" className="w-full" disabled={startSaleMutation.isPending} onClick={() => void handleStartSale()}>
          New sale
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Held sales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {held.length === 0 ? (
              <p className="text-sm text-muted-foreground">No held sales.</p>
            ) : (
              held.map((held_order) => (
                <button
                  key={held_order.id}
                  type="button"
                  onClick={() => {
                    setActiveOrderId(held_order.id);
                  }}
                  className="flex w-full items-center justify-between rounded-md border border-border p-3 text-left text-sm hover:bg-muted"
                >
                  <span>
                    <span className="font-medium">{held_order.orderNumber}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{held_order._count.items} item(s)</span>
                  </span>
                  <span className="tabular-nums">{formatCurrency(held_order.total)}</span>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || order === undefined) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (order.status === 'COMPLETED') {
    return <Receipt orderId={order.id} onNewSale={handleNewSale} />;
  }

  const canCharge = order.items.length > 0 && Number(order.outstanding) > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">{order.customer === null ? 'Walk-in' : `${order.customer.firstName} ${order.customer.lastName}`}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleNewSale}>
            Hold sale
          </Button>
          <Button
            variant="outline"
            disabled={cancelMutation.isPending}
            onClick={() => {
              void runAction(async () => {
                await cancelMutation.mutateAsync();
                handleNewSale();
              });
            }}
          >
            Cancel sale
          </Button>
        </div>
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Scan or search</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductPicker
                onSelect={(product) => {
                  void runAction(() => addItemMutation.mutateAsync(product.id));
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cart</CardTitle>
            </CardHeader>
            <CardContent>
              {order.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Cart is empty. Scan or search a product to add it.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Product</th>
                      <th className="pb-2 text-right font-medium">Qty</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="py-2">
                          {item.product.name}
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{item.product.sku}</span>
                        </td>
                        <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(item.total)}</td>
                        <td className="py-2 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void runAction(() => removeItemMutation.mutateAsync(item.id));
                            }}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomerPicker
                onSelect={(customer) => {
                  void runAction(() => updateHeaderMutation.mutateAsync({ customerId: customer.id }));
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="space-y-1">
                <Label htmlFor="pos-discount">Discount</Label>
                <Input
                  id="pos-discount"
                  inputMode="decimal"
                  defaultValue={order.discount}
                  onBlur={(event) => {
                    if (event.target.value !== order.discount) {
                      void runAction(() => updateHeaderMutation.mutateAsync({ discount: event.target.value }));
                    }
                  }}
                />
              </div>
              <SummaryRow label="Subtotal" value={formatCurrency(order.subtotal)} />
              <SummaryRow label="Total" value={formatCurrency(order.total)} strong />
              <SummaryRow label="Paid" value={formatCurrency(order.paidAmount)} />
              <SummaryRow label="Outstanding" value={formatCurrency(order.outstanding)} strong />

              <Button
                size="lg"
                className="w-full"
                disabled={!canCharge || confirmMutation.isPending}
                onClick={() => void handleCharge()}
              >
                Charge {formatCurrency(order.outstanding)}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <AddPaymentDialog
        open={paymentDialogOpen}
        onClose={() => {
          setPaymentDialogOpen(false);
        }}
        outstanding={order.outstanding}
        onSubmit={async (input) => {
          await ordersApi.addPayment(order.id, input);
          const updated = await ordersApi.get(order.id);
          if (Number(updated.outstanding) <= 0) {
            await ordersApi.complete(order.id);
            toast.success('Sale completed');
          }
          await invalidate();
        }}
      />
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.JSX.Element {
  return (
    <div className={`flex justify-between ${strong === true ? 'font-semibold' : 'text-muted-foreground'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Receipt({ orderId, onNewSale }: { orderId: string; onNewSale: () => void }): React.JSX.Element {
  const { data: order } = useQuery({ queryKey: ['order', orderId], queryFn: () => ordersApi.get(orderId) });

  if (order === undefined) {
    return <p className="text-sm text-muted-foreground">Loading receipt...</p>;
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div id="pos-receipt" className="space-y-3 rounded-md border border-border p-6 text-sm">
        <div className="text-center">
          <p className="text-lg font-semibold">Receipt</p>
          <p className="text-muted-foreground">{order.orderNumber}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(order.completedAt ?? order.createdAt)}</p>
        </div>
        <table className="w-full">
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="py-1">
                  {item.product.name} x{item.quantity}
                </td>
                <td className="py-1 text-right tabular-nums">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 border-t border-border pt-2">
          <SummaryRow label="Subtotal" value={formatCurrency(order.subtotal)} />
          <SummaryRow label="Discount" value={formatCurrency(order.discount)} />
          <SummaryRow label="Tax" value={formatCurrency(order.tax)} />
          <SummaryRow label="Total" value={formatCurrency(order.total)} strong />
        </div>
        <div className="space-y-1 border-t border-border pt-2">
          {order.payments.map((payment) => (
            <SummaryRow key={payment.id} label={PAYMENT_METHOD_LABELS[payment.method]} value={formatCurrency(payment.amount)} />
          ))}
        </div>
      </div>

      <div className="flex gap-2 print:hidden">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            window.print();
          }}
        >
          Print receipt
        </Button>
        <Button className="flex-1" onClick={onNewSale}>
          New sale
        </Button>
      </div>
    </div>
  );
}
