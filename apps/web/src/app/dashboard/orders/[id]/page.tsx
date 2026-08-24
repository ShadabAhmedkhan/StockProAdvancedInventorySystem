'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AddPaymentDialog } from '@/features/orders/components/add-payment-dialog';
import { CustomerPicker } from '@/features/orders/components/customer-picker';
import { OrderStatusBadge, PaymentStatusBadge } from '@/features/orders/components/order-status-badge';
import { ProductPicker } from '@/features/orders/components/product-picker';
import { ordersApi } from '@/features/orders/api';
import { PAYMENT_METHOD_LABELS } from '@/features/orders/labels';
import type { OrderDetail } from '@/features/orders/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const SELL_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);

export default function OrderDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const { user } = useAuth();
  const canSell = SELL_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const { data: order, isLoading, isError, error } = useQuery({ queryKey: ['order', orderId], queryFn: () => ordersApi.get(orderId) });

  const invalidate = async (): Promise<void> => {
    // Confirming/completing/cancelling a sale changes on-hand stock, so the inventory
    // list (and anything else keyed off product/stock data) must refetch, not just this order.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-summary'] }),
    ]);
  };

  const [actionError, setActionError] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const addItemMutation = useMutation({ mutationFn: (productId: string) => ordersApi.addItem(orderId, { productId, quantity: 1 }) });
  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) => ordersApi.updateItem(orderId, itemId, { quantity }),
  });
  const removeItemMutation = useMutation({ mutationFn: (itemId: string) => ordersApi.removeItem(orderId, itemId) });
  const confirmMutation = useMutation({ mutationFn: () => ordersApi.confirm(orderId) });
  const completeMutation = useMutation({ mutationFn: () => ordersApi.complete(orderId) });
  const cancelMutation = useMutation({ mutationFn: () => ordersApi.cancel(orderId) });
  const updateHeaderMutation = useMutation({
    mutationFn: (input: { customerId?: string; discount?: string; tax?: string; notes?: string }) => ordersApi.update(orderId, input),
  });

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await invalidate();
    } catch (submitError) {
      setActionError(errorMessage(submitError));
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (isError || order === undefined) {
    return <p className="text-sm text-red-600">{errorMessage(error)}</p>;
  }

  const isDraft = order.status === 'DRAFT';
  const canConfirm = isDraft && order.items.length > 0;
  const canComplete = order.status === 'CONFIRMED';
  const canCancel = isDraft || order.status === 'CONFIRMED';
  const canRecordPayment = (order.status === 'CONFIRMED' || order.status === 'COMPLETED') && Number(order.outstanding) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/orders" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to orders
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{order.orderNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
          </div>
        </div>

        {canSell && (
          <div className="flex flex-wrap gap-2">
            {canConfirm && (
              <Button
                disabled={confirmMutation.isPending}
                onClick={() => {
                  void runAction(() => confirmMutation.mutateAsync());
                }}
              >
                Confirm order
              </Button>
            )}
            {canComplete && (
              <Button
                disabled={completeMutation.isPending}
                onClick={() => {
                  void runAction(() => completeMutation.mutateAsync());
                }}
              >
                Complete sale
              </Button>
            )}
            {canRecordPayment && (
              <Button
                variant="outline"
                onClick={() => {
                  setPaymentDialogOpen(true);
                }}
              >
                Record payment
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  void runAction(() => cancelMutation.mutateAsync());
                }}
              >
                Cancel order
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError !== null && <p className="text-sm text-red-600">{actionError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {order.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Product</th>
                        <th className="pb-2 text-right font-medium">Qty</th>
                        <th className="pb-2 text-right font-medium">Unit price</th>
                        <th className="pb-2 text-right font-medium">Discount</th>
                        <th className="pb-2 text-right font-medium">Total</th>
                        {isDraft && <th className="pb-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => (
                        <tr key={item.id} className="border-b border-border last:border-0">
                          <td className="py-2">
                            {item.product.name}
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{item.product.sku}</span>
                          </td>
                          <td className="py-2 text-right">
                            {isDraft ? (
                              <Input
                                type="number"
                                min={1}
                                defaultValue={item.quantity}
                                className="ml-auto w-16 text-right"
                                onBlur={(event) => {
                                  const quantity = Number(event.target.value);
                                  if (quantity > 0 && quantity !== item.quantity) {
                                    void runAction(() => updateItemMutation.mutateAsync({ itemId: item.id, quantity }));
                                  }
                                }}
                              />
                            ) : (
                              item.quantity
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(item.unitPrice)}</td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(item.discount)}</td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(item.total)}</td>
                          {isDraft && (
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
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {isDraft && canSell && (
                <ProductPicker
                  onSelect={(product) => {
                    void runAction(() => addItemMutation.mutateAsync(product.id));
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {order.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Method</th>
                      <th className="pb-2 font-medium">Reference</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.payments.map((payment) => (
                      <tr key={payment.id} className="border-b border-border last:border-0">
                        <td className="py-2 text-muted-foreground">{formatDateTime(payment.paidAt)}</td>
                        <td className="py-2">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                        <td className="py-2 text-muted-foreground">{payment.reference ?? '-'}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(payment.amount)}</td>
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
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <SummaryRow label="Subtotal" value={formatCurrency(order.subtotal)} />
              <SummaryRow label="Discount" value={formatCurrency(order.discount)} />
              <SummaryRow label="Tax" value={formatCurrency(order.tax)} />
              <SummaryRow label="Total" value={formatCurrency(order.total)} strong />
              <SummaryRow label="Paid" value={formatCurrency(order.paidAmount)} />
              <SummaryRow label="Outstanding" value={formatCurrency(order.outstanding)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p>{order.customer === null ? 'Walk-in' : `${order.customer.firstName} ${order.customer.lastName}`}</p>
                {isDraft && canSell && (
                  <div className="mt-2">
                    <CustomerPicker
                      onSelect={(customer) => {
                        void runAction(() => updateHeaderMutation.mutateAsync({ customerId: customer.id }));
                      }}
                    />
                  </div>
                )}
              </div>

              {isDraft && canSell ? (
                <OrderHeaderForm order={order} onSave={(input) => runAction(() => updateHeaderMutation.mutateAsync(input))} />
              ) : (
                order.notes !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p>{order.notes}</p>
                  </div>
                )
              )}

              <div>
                <p className="text-xs text-muted-foreground">Sold by</p>
                <p>
                  {order.createdBy.firstName} {order.createdBy.lastName}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p>{formatDateTime(order.createdAt)}</p>
              </div>
              {order.completedAt !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p>{formatDateTime(order.completedAt)}</p>
                </div>
              )}
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
          await ordersApi.addPayment(orderId, input);
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

function OrderHeaderForm({
  order,
  onSave,
}: {
  order: OrderDetail;
  onSave: (input: { discount?: string; tax?: string; notes?: string }) => Promise<void>;
}): React.JSX.Element {
  const [discount, setDiscount] = useState(order.discount);
  const [tax, setTax] = useState(order.tax);
  const [notes, setNotes] = useState(order.notes ?? '');

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="order-discount">Discount</Label>
          <Input
            id="order-discount"
            inputMode="decimal"
            value={discount}
            onChange={(event) => {
              setDiscount(event.target.value);
            }}
            onBlur={() => {
              if (discount !== order.discount) {
                void onSave({ discount });
              }
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="order-tax">Tax</Label>
          <Input
            id="order-tax"
            inputMode="decimal"
            value={tax}
            onChange={(event) => {
              setTax(event.target.value);
            }}
            onBlur={() => {
              if (tax !== order.tax) {
                void onSave({ tax });
              }
            }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="order-notes">Notes</Label>
        <Textarea
          id="order-notes"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
          onBlur={() => {
            if (notes !== (order.notes ?? '')) {
              void onSave({ notes });
            }
          }}
        />
      </div>
    </div>
  );
}
