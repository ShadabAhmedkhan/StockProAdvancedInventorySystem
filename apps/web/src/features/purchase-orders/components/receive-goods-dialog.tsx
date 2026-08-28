'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import type { CreateGoodsReceiptInput } from '../api';
import type { PurchaseOrderItem } from '../types';

interface ReceiveGoodsDialogProps {
  open: boolean;
  onClose: () => void;
  items: PurchaseOrderItem[];
  onSubmit: (input: CreateGoodsReceiptInput) => Promise<unknown>;
}

/** Only lines with something still outstanding can take a delivery. */
function outstandingOf(item: PurchaseOrderItem): number {
  return item.quantity - item.receivedQuantity;
}

export function ReceiveGoodsDialog({ open, onClose, items, onSubmit }: ReceiveGoodsDialogProps): React.JSX.Element {
  const receivable = items.filter((item) => outstandingOf(item) > 0);

  return (
    <Dialog open={open} onClose={onClose} title="Record a delivery">
      {open && (
        // Keyed by the item set so re-opening after a partial receipt starts with fresh, correct outstanding quantities.
        <ReceiveGoodsForm key={receivable.map((item) => `${item.id}:${item.receivedQuantity}`).join(',')} items={receivable} onClose={onClose} onSubmit={onSubmit} />
      )}
    </Dialog>
  );
}

function ReceiveGoodsForm({
  items,
  onClose,
  onSubmit,
}: {
  items: PurchaseOrderItem[];
  onClose: () => void;
  onSubmit: (input: CreateGoodsReceiptInput) => Promise<unknown>;
}): React.JSX.Element {
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, String(outstandingOf(item))])),
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const lines = items
      .map((item) => ({ purchaseOrderItemId: item.id, quantityReceived: Number(quantities[item.id] ?? '0') }))
      .filter((line) => line.quantityReceived > 0);

    if (lines.length === 0) {
      setError('Enter a quantity for at least one line');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({ items: lines, note: note.trim() === '' ? undefined : note });
      toast.success('Delivery recorded');
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
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is still outstanding on this order.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{item.product.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {item.product.sku} &middot; {outstandingOf(item)} outstanding
                </p>
              </div>
              <Input
                type="number"
                min={0}
                max={outstandingOf(item)}
                className="w-24 shrink-0 text-right"
                value={quantities[item.id] ?? ''}
                onChange={(event) => {
                  setQuantities((current) => ({ ...current, [item.id]: event.target.value }));
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="receipt-note">Note</Label>
        <Input
          id="receipt-note"
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
        <Button type="submit" disabled={isSubmitting || items.length === 0}>
          {isSubmitting ? 'Recording...' : 'Record delivery'}
        </Button>
      </div>
    </form>
  );
}
