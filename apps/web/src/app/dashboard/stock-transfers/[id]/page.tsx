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
import { ProductPicker } from '@/features/orders/components/product-picker';
import { stockTransfersApi } from '@/features/stock-transfers/api';
import { StockTransferStatusBadge } from '@/features/stock-transfers/components/stock-transfer-status-badge';
import type { StockTransferDetail } from '@/features/stock-transfers/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const TRANSFER_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function StockTransferDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const transferId = params.id;
  const { user } = useAuth();
  const canTransfer = TRANSFER_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const { data: transfer, isLoading, isError, error } = useQuery({ queryKey: ['stock-transfer', transferId], queryFn: () => stockTransfersApi.get(transferId) });

  const invalidate = async (): Promise<void> => {
    // Shipping/completing changes on-hand stock at both locations, so inventory and product data must refetch too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stock-transfer', transferId] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-summary'] }),
    ]);
  };

  const [actionError, setActionError] = useState<string | null>(null);

  const addItemMutation = useMutation({ mutationFn: (productId: string) => stockTransfersApi.addItem(transferId, { productId, quantity: 1 }) });
  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) => stockTransfersApi.updateItem(transferId, itemId, { quantity }),
  });
  const removeItemMutation = useMutation({ mutationFn: (itemId: string) => stockTransfersApi.removeItem(transferId, itemId) });
  const requestMutation = useMutation({ mutationFn: () => stockTransfersApi.request(transferId) });
  const approveMutation = useMutation({ mutationFn: () => stockTransfersApi.approve(transferId) });
  const shipMutation = useMutation({ mutationFn: () => stockTransfersApi.ship(transferId) });
  const completeMutation = useMutation({ mutationFn: () => stockTransfersApi.complete(transferId) });
  const cancelMutation = useMutation({ mutationFn: () => stockTransfersApi.cancel(transferId) });
  const updateHeaderMutation = useMutation({ mutationFn: (input: { notes?: string }) => stockTransfersApi.update(transferId, input) });

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
  if (isError || transfer === undefined) {
    return <p className="text-sm text-danger">{errorMessage(error)}</p>;
  }

  const isDraft = transfer.status === 'DRAFT';
  const canRequest = isDraft && transfer.items.length > 0;
  const canApprove = transfer.status === 'REQUESTED';
  const canShip = transfer.status === 'APPROVED';
  const canComplete = transfer.status === 'IN_TRANSIT';
  const canCancel = transfer.status === 'DRAFT' || transfer.status === 'REQUESTED' || transfer.status === 'APPROVED';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/stock-transfers" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to stock transfers
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{transfer.transferNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StockTransferStatusBadge status={transfer.status} />
          </div>
        </div>

        {canTransfer && (
          <div className="flex flex-wrap gap-2">
            {canRequest && (
              <Button
                disabled={requestMutation.isPending}
                onClick={() => {
                  void runAction(() => requestMutation.mutateAsync(), 'Transfer requested');
                }}
              >
                Request
              </Button>
            )}
            {canApprove && (
              <Button
                disabled={approveMutation.isPending}
                onClick={() => {
                  void runAction(() => approveMutation.mutateAsync(), 'Transfer approved');
                }}
              >
                Approve
              </Button>
            )}
            {canShip && (
              <Button
                disabled={shipMutation.isPending}
                onClick={() => {
                  void runAction(() => shipMutation.mutateAsync(), 'Marked as shipped');
                }}
              >
                Ship
              </Button>
            )}
            {canComplete && (
              <Button
                disabled={completeMutation.isPending}
                onClick={() => {
                  void runAction(() => completeMutation.mutateAsync(), 'Transfer completed');
                }}
              >
                Complete
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                disabled={cancelMutation.isPending}
                onClick={() => {
                  void runAction(() => cancelMutation.mutateAsync(), 'Transfer cancelled');
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
              {transfer.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Product</th>
                        <th className="pb-2 text-right font-medium">Qty</th>
                        {isDraft && <th className="pb-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {transfer.items.map((item) => (
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

              {isDraft && canTransfer && (
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
              <CardTitle>Route</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">From</p>
                <p>{transfer.sourceLocation.name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">To</p>
                <p>{transfer.destinationLocation.name}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {isDraft && canTransfer ? (
                <StockTransferHeaderForm transfer={transfer} onSave={(input) => runAction(() => updateHeaderMutation.mutateAsync(input))} />
              ) : (
                transfer.notes !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p>{transfer.notes}</p>
                  </div>
                )
              )}

              <div>
                <p className="text-xs text-muted-foreground">Raised by</p>
                <p>
                  {transfer.createdBy.firstName} {transfer.createdBy.lastName}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p>{formatDateTime(transfer.createdAt)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StockTransferHeaderForm({
  transfer,
  onSave,
}: {
  transfer: StockTransferDetail;
  onSave: (input: { notes?: string }) => Promise<void>;
}): React.JSX.Element {
  const [notes, setNotes] = useState(transfer.notes ?? '');

  return (
    <div className="space-y-1">
      <Label htmlFor="transfer-notes">Notes</Label>
      <Textarea
        id="transfer-notes"
        value={notes}
        onChange={(event) => {
          setNotes(event.target.value);
        }}
        onBlur={() => {
          if (notes !== (transfer.notes ?? '')) {
            void onSave({ notes });
          }
        }}
      />
    </div>
  );
}
