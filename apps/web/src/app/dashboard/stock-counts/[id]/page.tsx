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
import { stockCountsApi } from '@/features/stock-counts/api';
import { StockCountStatusBadge } from '@/features/stock-counts/components/stock-count-status-badge';
import type { StockCountDetail, StockCountItem } from '@/features/stock-counts/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

const MANAGE_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function StockCountDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const countId = params.id;
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const { data: count, isLoading, isError, error } = useQuery({ queryKey: ['stock-count', countId], queryFn: () => stockCountsApi.get(countId) });

  const invalidate = async (): Promise<void> => {
    // Approving changes on-hand stock, so inventory data must refetch too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['stock-count', countId] }),
      queryClient.invalidateQueries({ queryKey: ['products'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] }),
      queryClient.invalidateQueries({ queryKey: ['stock-summary'] }),
    ]);
  };

  const [actionError, setActionError] = useState<string | null>(null);

  const addItemMutation = useMutation({ mutationFn: (productId: string) => stockCountsApi.addItem(countId, productId) });
  const removeItemMutation = useMutation({ mutationFn: (itemId: string) => stockCountsApi.removeItem(countId, itemId) });
  const startMutation = useMutation({ mutationFn: () => stockCountsApi.start(countId) });
  const submitForReviewMutation = useMutation({ mutationFn: () => stockCountsApi.submitForReview(countId) });
  const approveMutation = useMutation({ mutationFn: () => stockCountsApi.approve(countId) });
  const completeMutation = useMutation({ mutationFn: () => stockCountsApi.complete(countId) });
  const cancelMutation = useMutation({ mutationFn: () => stockCountsApi.cancel(countId) });
  const updateHeaderMutation = useMutation({ mutationFn: (input: { notes?: string }) => stockCountsApi.update(countId, input) });
  const submitCountMutation = useMutation({
    mutationFn: ({ itemId, countedQuantity }: { itemId: string; countedQuantity: number }) => stockCountsApi.submitCount(countId, itemId, countedQuantity),
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
  if (isError || count === undefined) {
    return <p className="text-sm text-danger">{errorMessage(error)}</p>;
  }

  const isDraft = count.status === 'DRAFT';
  const isCounting = count.status === 'COUNTING';
  const canStart = isDraft && count.items.length > 0;
  const canSubmitForReview = isCounting;
  const canApprove = count.status === 'REVIEW';
  const canComplete = count.status === 'APPROVED';
  const canCancel = count.status === 'DRAFT' || count.status === 'COUNTING' || count.status === 'REVIEW';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/stock-counts" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to stock counts
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{count.countNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StockCountStatusBadge status={count.status} />
            <span className="text-sm text-muted-foreground">{count.location.name}</span>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            {canStart && (
              <Button
                disabled={startMutation.isPending}
                onClick={() => {
                  void runAction(() => startMutation.mutateAsync(), 'Counting started');
                }}
              >
                Start counting
              </Button>
            )}
            {canSubmitForReview && (
              <Button
                disabled={submitForReviewMutation.isPending}
                onClick={() => {
                  void runAction(() => submitForReviewMutation.mutateAsync(), 'Submitted for review');
                }}
              >
                Submit for review
              </Button>
            )}
            {canApprove && (
              <Button
                disabled={approveMutation.isPending}
                onClick={() => {
                  void runAction(() => approveMutation.mutateAsync(), 'Count approved - variances applied');
                }}
              >
                Approve
              </Button>
            )}
            {canComplete && (
              <Button
                disabled={completeMutation.isPending}
                onClick={() => {
                  void runAction(() => completeMutation.mutateAsync(), 'Count completed');
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
                  void runAction(() => cancelMutation.mutateAsync(), 'Count cancelled');
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
              {count.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              ) : (
                <ItemsTable
                  count={count}
                  canManage={canManage}
                  onCount={(itemId, countedQuantity) => {
                    void runAction(() => submitCountMutation.mutateAsync({ itemId, countedQuantity }));
                  }}
                  onRemove={(itemId) => {
                    void runAction(() => removeItemMutation.mutateAsync(itemId));
                  }}
                />
              )}

              {isDraft && canManage && (
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
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {isDraft && canManage ? (
                <StockCountHeaderForm count={count} onSave={(input) => runAction(() => updateHeaderMutation.mutateAsync(input))} />
              ) : (
                count.notes !== null && (
                  <div>
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p>{count.notes}</p>
                  </div>
                )
              )}

              <div>
                <p className="text-xs text-muted-foreground">Raised by</p>
                <p>
                  {count.createdBy.firstName} {count.createdBy.lastName}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p>{formatDateTime(count.createdAt)}</p>
              </div>
              {count.approvedBy !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Approved by</p>
                  <p>
                    {count.approvedBy.firstName} {count.approvedBy.lastName}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ItemsTable({
  count,
  canManage,
  onCount,
  onRemove,
}: {
  count: StockCountDetail;
  canManage: boolean;
  onCount: (itemId: string, countedQuantity: number) => void;
  onRemove: (itemId: string) => void;
}): React.JSX.Element {
  const isDraft = count.status === 'DRAFT';
  const isCounting = count.status === 'COUNTING';
  // Blind counting: the API withholds expectedQuantity until REVIEW, so the column only makes sense once it's populated.
  const showExpected = count.items.some((item) => item.expectedQuantity !== null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Product</th>
            {showExpected && <th className="pb-2 text-right font-medium">Expected</th>}
            <th className="pb-2 text-right font-medium">Counted</th>
            {showExpected && <th className="pb-2 text-right font-medium">Variance</th>}
            {isDraft && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {count.items.map((item) => (
            <ItemRow key={item.id} item={item} isCounting={isCounting} isDraft={isDraft} canManage={canManage} showExpected={showExpected} onCount={onCount} onRemove={onRemove} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemRow({
  item,
  isCounting,
  isDraft,
  canManage,
  showExpected,
  onCount,
  onRemove,
}: {
  item: StockCountItem;
  isCounting: boolean;
  isDraft: boolean;
  canManage: boolean;
  showExpected: boolean;
  onCount: (itemId: string, countedQuantity: number) => void;
  onRemove: (itemId: string) => void;
}): React.JSX.Element {
  const [draftCount, setDraftCount] = useState(item.countedQuantity?.toString() ?? '');
  const variance = item.expectedQuantity !== null && item.countedQuantity !== null ? item.countedQuantity - item.expectedQuantity : null;

  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2">
        {item.product.name}
        <span className="ml-2 font-mono text-xs text-muted-foreground">{item.product.sku}</span>
      </td>
      {showExpected && <td className="py-2 text-right tabular-nums">{item.expectedQuantity ?? '—'}</td>}
      <td className="py-2 text-right">
        {isCounting ? (
          <Input
            type="number"
            min={0}
            value={draftCount}
            className="ml-auto w-20 text-right"
            onChange={(event) => {
              setDraftCount(event.target.value);
            }}
            onBlur={() => {
              const quantity = Number(draftCount);
              if (draftCount !== '' && quantity >= 0 && quantity !== item.countedQuantity) {
                onCount(item.id, quantity);
              }
            }}
          />
        ) : (
          <span className="tabular-nums">{item.countedQuantity ?? '—'}</span>
        )}
      </td>
      {showExpected && (
        <td className={`py-2 text-right tabular-nums ${variance !== null && variance !== 0 ? 'font-medium text-warning' : ''}`}>
          {variance === null ? '—' : variance > 0 ? `+${String(variance)}` : variance}
        </td>
      )}
      {isDraft && canManage && (
        <td className="py-2 text-right">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onRemove(item.id);
            }}
          >
            Remove
          </Button>
        </td>
      )}
    </tr>
  );
}

function StockCountHeaderForm({ count, onSave }: { count: StockCountDetail; onSave: (input: { notes?: string }) => Promise<void> }): React.JSX.Element {
  const [notes, setNotes] = useState(count.notes ?? '');

  return (
    <div className="space-y-1">
      <Label htmlFor="count-notes">Notes</Label>
      <Textarea
        id="count-notes"
        value={notes}
        onChange={(event) => {
          setNotes(event.target.value);
        }}
        onBlur={() => {
          if (notes !== (count.notes ?? '')) {
            void onSave({ notes });
          }
        }}
      />
    </div>
  );
}
