'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { purchaseOrdersApi } from '@/features/purchase-orders/api';
import { ProductPicker } from '@/features/orders/components/product-picker';
import { PurchaseOrderStatusBadge } from '@/features/purchase-orders/components/purchase-order-status-badge';
import { ReceiveGoodsDialog } from '@/features/purchase-orders/components/receive-goods-dialog';
import type { PurchaseOrderDetail } from '@/features/purchase-orders/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const PURCHASE_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function PurchaseOrderDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const purchaseOrderId = params.id;
  const { user } = useAuth();
  const canPurchase = PURCHASE_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const { data: po, isLoading, isError, error } = useQuery({ queryKey: ['purchase-order', purchaseOrderId], queryFn: () => purchaseOrdersApi.get(purchaseOrderId) });

  const invalidate = async (): Promise<void> => {
    // Receiving goods changes on-hand stock, so inventory and product data must refetch too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['purchase-order', purchaseOrderId] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-summary'] }),
    ]);
  };

  const [actionError, setActionError] = useState<string | null>(null);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);

  const addItemMutation = useMutation({ mutationFn: (productId: string) => purchaseOrdersApi.addItem(purchaseOrderId, { productId, quantity: 1 }) });
  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) => purchaseOrdersApi.updateItem(purchaseOrderId, itemId, { quantity }),
  });
  const removeItemMutation = useMutation({ mutationFn: (itemId: string) => purchaseOrdersApi.removeItem(purchaseOrderId, itemId) });
  const approveMutation = useMutation({ mutationFn: () => purchaseOrdersApi.approve(purchaseOrderId) });
  const orderMutation = useMutation({ mutationFn: () => purchaseOrdersApi.order(purchaseOrderId) });
  const cancelMutation = useMutation({ mutationFn: () => purchaseOrdersApi.cancel(purchaseOrderId) });
  const updateHeaderMutation = useMutation({
    mutationFn: (input: { discount?: string; tax?: string; shipping?: string; notes?: string }) => purchaseOrdersApi.update(purchaseOrderId, input),
  });

  async function runAction(action: () => Promise<unknown>, successMessage?: string): Promise<void> {
    setActionError(null);
    try {
      await action();
      await invalidate();
      if (successMessage !== undefined) {
        toast.success(successMessage);
      }
    } catch (submitError) {
      setActionError(errorMessage(submitError));
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (isError || po === undefined) {
    return <p className="text-sm text-danger">{errorMessage(error)}</p>;
  }

  const isDraft = po.status === 'DRAFT';
  const canApprove = isDraft && po.items.length > 0;
  const canOrder = po.status === 'APPROVED';
  const canReceive = po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED';
  const canCancel = po.status === 'DRAFT' || po.status === 'APPROVED' || po.status === 'ORDERED';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/purchase-orders" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to purchase orders
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{po.poNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <PurchaseOrderStatusBadge status={po.status} />
          </div>
        </div>

        {canPurchase && (
          <div className="flex flex-wrap gap-2">
            {canApprove && (
              <Button
                disabled={approveMutation.isPending}
                onClick={() => {
                  void runAction(() => approveMutation.mutateAsync(), 'Purchase order approved');
                }}
              >
                Approve
              </Button>
            )}
            {canOrder && (
              <Button
                disabled={orderMutation.isPending}
                onClick={() => {
                  void runAction(() => orderMutation.mutateAsync(), 'Marked as sent to supplier');
                }}
              >
                Mark as ordered
              </Button>
            )}
            {canReceive && (
              <Button
                variant="outline"
                onClick={() => {
                  setReceiveDialogOpen(true);
                }}
              >
                Receive goods
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  void runAction(() => cancelMutation.mutateAsync(), 'Purchase order cancelled');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {po.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Product</th>
                        <th className="pb-2 text-right font-medium">Qty</th>
                        <th className="pb-2 text-right font-medium">Received</th>
                        <th className="pb-2 text-right font-medium">Unit cost</th>
                        <th className="pb-2 text-right font-medium">Discount</th>
                        <th className="pb-2 text-right font-medium">Total</th>
                        {isDraft && <th className="pb-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {po.items.map((item) => (
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
                          <td className="py-2 text-right tabular-nums">{item.receivedQuantity}</td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(item.unitCost)}</td>
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

              {isDraft && canPurchase && (
                <ProductPicker
                  onSelect={(product) => {
                    void runAction(() => addItemMutation.mutateAsync(product.id));
                  }}
                />
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
              <SummaryRow label="Subtotal" value={formatCurrency(po.subtotal)} />
              <SummaryRow label="Discount" value={formatCurrency(po.discount)} />
              <SummaryRow label="Tax" value={formatCurrency(po.tax)} />
              <SummaryRow label="Shipping" value={formatCurrency(po.shipping)} />
              <SummaryRow label="Total" value={formatCurrency(po.total)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Supplier</p>
                <p>{po.supplier.name}</p>
              </div>

              {isDraft && canPurchase ? (
                <PurchaseOrderHeaderForm po={po} onSave={(input) => runAction(() => updateHeaderMutation.mutateAsync(input))} />
              ) : (
                po.notes !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p>{po.notes}</p>
                  </div>
                )
              )}

              <div>
                <p className="text-xs text-muted-foreground">Raised by</p>
                <p>
                  {po.createdBy.firstName} {po.createdBy.lastName}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p>{formatDateTime(po.createdAt)}</p>
              </div>
              {po.expectedDate !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Expected</p>
                  <p>{formatDateTime(po.expectedDate)}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ReceiveGoodsDialog
        open={receiveDialogOpen}
        onClose={() => {
          setReceiveDialogOpen(false);
        }}
        items={po.items}
        onSubmit={async (input) => {
          await purchaseOrdersApi.receiveGoods(purchaseOrderId, input);
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

function PurchaseOrderHeaderForm({
  po,
  onSave,
}: {
  po: PurchaseOrderDetail;
  onSave: (input: { discount?: string; tax?: string; shipping?: string; notes?: string }) => Promise<void>;
}): React.JSX.Element {
  const [discount, setDiscount] = useState(po.discount);
  const [tax, setTax] = useState(po.tax);
  const [shipping, setShipping] = useState(po.shipping);
  const [notes, setNotes] = useState(po.notes ?? '');

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="po-discount">Discount</Label>
          <Input
            id="po-discount"
            inputMode="decimal"
            value={discount}
            onChange={(event) => {
              setDiscount(event.target.value);
            }}
            onBlur={() => {
              if (discount !== po.discount) {
                void onSave({ discount });
              }
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-tax">Tax</Label>
          <Input
            id="po-tax"
            inputMode="decimal"
            value={tax}
            onChange={(event) => {
              setTax(event.target.value);
            }}
            onBlur={() => {
              if (tax !== po.tax) {
                void onSave({ tax });
              }
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="po-shipping">Shipping</Label>
          <Input
            id="po-shipping"
            inputMode="decimal"
            value={shipping}
            onChange={(event) => {
              setShipping(event.target.value);
            }}
            onBlur={() => {
              if (shipping !== po.shipping) {
                void onSave({ shipping });
              }
            }}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="po-notes">Notes</Label>
        <Textarea
          id="po-notes"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
          onBlur={() => {
            if (notes !== (po.notes ?? '')) {
              void onSave({ notes });
            }
          }}
        />
      </div>
    </div>
  );
}
