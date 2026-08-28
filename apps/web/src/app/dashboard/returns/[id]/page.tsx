'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ordersApi } from '@/features/orders/api';
import { PAYMENT_METHOD_LABELS } from '@/features/orders/labels';
import type { PaymentMethod } from '@/features/orders/types';
import { returnsApi, type CreateReturnItemInput } from '@/features/returns/api';
import { ReturnStatusBadge } from '@/features/returns/components/return-status-badge';
import { RETURN_REASON_LABELS } from '@/features/returns/labels';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const MANAGE_ITEMS_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);
const DECIDE_ROLES = new Set(['ADMIN', 'MANAGER']);
const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

export default function ReturnDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);

  const canManageItems = MANAGE_ITEMS_ROLES.has(user?.role ?? '');
  const canDecide = DECIDE_ROLES.has(user?.role ?? '');

  const { data: returnRecord, isLoading, isError, error } = useQuery({ queryKey: ['return', id], queryFn: () => returnsApi.get(id) });

  const orderId = returnRecord?.orderId;
  const orderItemsQuery = useQuery({
    queryKey: ['order-detail-for-return', orderId],
    queryFn: () => ordersApi.get(orderId ?? ''),
    enabled: orderId !== undefined && returnRecord?.status === 'PENDING' && canManageItems,
  });

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ['return', id] });
    void queryClient.invalidateQueries({ queryKey: ['returns'] });
    // Completing a return restocks the item, so the inventory list must refetch too.
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-summary'] });
  }

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => returnsApi.removeItem(id, itemId),
    onSuccess: invalidate,
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) => returnsApi.updateItem(id, itemId, { quantity }),
    onSuccess: invalidate,
  });

  const addItemMutation = useMutation({
    mutationFn: (input: CreateReturnItemInput) => returnsApi.addItem(id, input),
    onSuccess: invalidate,
  });

  const approveMutation = useMutation({ mutationFn: () => returnsApi.approve(id), onSuccess: invalidate });
  const rejectMutation = useMutation({ mutationFn: () => returnsApi.reject(id), onSuccess: invalidate });

  async function runAction(action: () => Promise<unknown>, successMessage?: string): Promise<void> {
    setActionError(null);
    try {
      await action();
      if (successMessage !== undefined) {
        toast.success(successMessage);
      }
    } catch (actionErr) {
      setActionError(errorMessage(actionErr));
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (isError || returnRecord === undefined) return <p className="text-sm text-danger">{errorMessage(error)}</p>;

  const isPending = returnRecord.status === 'PENDING';
  const returnedOrderItemIds = new Set(returnRecord.items.map((item) => item.orderItemId));
  const addableItems = (orderItemsQuery.data?.items ?? []).filter((item) => !returnedOrderItemIds.has(item.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{returnRecord.returnNumber}</h1>
          <p className="text-sm text-muted-foreground">
            Against order{' '}
            <Link href={`/dashboard/orders/${returnRecord.orderId}`} className="hover:underline">
              {returnRecord.order.orderNumber}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ReturnStatusBadge status={returnRecord.status} />
          {isPending && canDecide && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void runAction(() => rejectMutation.mutateAsync(), 'Return rejected');
                }}
                disabled={rejectMutation.isPending}
              >
                Reject
              </Button>
              <Button
                onClick={() => {
                  void runAction(() => approveMutation.mutateAsync(), 'Return approved');
                }}
                disabled={approveMutation.isPending}
              >
                Approve
              </Button>
            </>
          )}
          {returnRecord.status === 'APPROVED' && canDecide && (
            <Button
              onClick={() => {
                setCompleteOpen(true);
              }}
            >
              Complete &amp; refund
            </Button>
          )}
        </div>
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {returnRecord.items.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                  <span className="min-w-0 flex-1">
                    {item.product.name} <span className="text-xs text-muted-foreground">({item.product.sku})</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatCurrency(item.unitPrice)} each</span>
                  {isPending && canManageItems ? (
                    <Input
                      type="number"
                      min={1}
                      max={item.orderItem.quantity}
                      defaultValue={item.quantity}
                      className="w-20"
                      onBlur={(event) => {
                        const quantity = Number(event.target.value);
                        if (quantity > 0 && quantity !== item.quantity) {
                          void runAction(() => updateItemMutation.mutateAsync({ itemId: item.id, quantity }));
                        }
                      }}
                    />
                  ) : (
                    <span className="w-20 text-right tabular-nums">x{item.quantity}</span>
                  )}
                  <Badge className={item.restock ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>{item.restock ? 'Restock' : 'Write off'}</Badge>
                  <span className="w-24 text-right tabular-nums">{formatCurrency(item.total)}</span>
                  {isPending && canManageItems && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void runAction(() => removeItemMutation.mutateAsync(item.id));
                      }}
                      disabled={removeItemMutation.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}

              {isPending && canManageItems && addableItems.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <Label>Add another line</Label>
                  <div className="divide-y divide-border rounded-md border border-border">
                    {addableItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 p-2 text-sm">
                        <span>
                          {item.product.name} <span className="text-xs text-muted-foreground">(sold {item.quantity})</span>
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void runAction(() => addItemMutation.mutateAsync({ orderItemId: item.id, quantity: item.quantity, restock: true }));
                          }}
                          disabled={addItemMutation.isPending}
                        >
                          Add
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {returnRecord.payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Refunds</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {returnRecord.payments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between text-sm">
                    <span>
                      {payment.paymentNumber} &middot; {PAYMENT_METHOD_LABELS[payment.method]}
                    </span>
                    <span className="tabular-nums">{formatCurrency(payment.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Refund credit</span>
                <span className="tabular-nums">{formatCurrency(returnRecord.refundAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Paid back</span>
                <span className="tabular-nums">{formatCurrency(returnRecord.paidBackAmount)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Outstanding credit</span>
                <span className="tabular-nums">{formatCurrency(returnRecord.outstandingCredit)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reason</span>
                <span>{RETURN_REASON_LABELS[returnRecord.reason]}</span>
              </div>
              {returnRecord.reasonNote !== null && <p className="text-muted-foreground">{returnRecord.reasonNote}</p>}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer</span>
                <span>{returnRecord.customer === null ? '-' : `${returnRecord.customer.firstName} ${returnRecord.customer.lastName}`}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Raised</span>
                <span>{formatDateTime(returnRecord.createdAt)}</span>
              </div>
              {returnRecord.completedAt !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Completed</span>
                  <span>{formatDateTime(returnRecord.completedAt)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Button
            variant="outline"
            onClick={() => {
              router.push('/dashboard/returns');
            }}
          >
            Back to returns
          </Button>
        </div>
      </div>

      <CompleteReturnDialog
        open={completeOpen}
        onClose={() => {
          setCompleteOpen(false);
        }}
        returnId={id}
        onCompleted={invalidate}
      />
    </div>
  );
}

function CompleteReturnDialog({
  open,
  onClose,
  returnId,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  returnId: string;
  onCompleted: () => void;
}): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Complete return">
      {open && <CompleteReturnForm returnId={returnId} onClose={onClose} onCompleted={onCompleted} />}
    </Dialog>
  );
}

function CompleteReturnForm({ returnId, onClose, onCompleted }: { returnId: string; onClose: () => void; onCompleted: () => void }): React.JSX.Element {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await returnsApi.complete(returnId, { method, reference: reference.trim() === '' ? undefined : reference, note: note.trim() === '' ? undefined : note });
      toast.success('Return completed');
      onCompleted();
      onClose();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-3"
    >
      <p className="text-xs text-muted-foreground">
        Restocks whichever lines were marked restockable and refunds whatever the customer actually paid on this order.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="refund-method">Refund method</Label>
        <Select
          id="refund-method"
          value={method}
          onChange={(event) => {
            setMethod(event.target.value as PaymentMethod);
          }}
        >
          {METHODS.map((value) => (
            <option key={value} value={value}>
              {PAYMENT_METHOD_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="refund-reference">Reference</Label>
        <Input
          id="refund-reference"
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="refund-note">Note</Label>
        <Input
          id="refund-note"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Completing...' : 'Complete & refund'}
        </Button>
      </div>
    </form>
  );
}
