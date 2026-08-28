'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/error-message';
import type { StockAdjustInput } from '../api';
import type { ManualMovementType, StockLevel } from '../types';

const MOVEMENT_OPTIONS: { value: ManualMovementType; label: string }[] = [
  { value: 'PURCHASE', label: 'Purchase received' },
  { value: 'ADJUSTMENT_IN', label: 'Adjustment (add stock)' },
  { value: 'ADJUSTMENT_OUT', label: 'Adjustment (remove stock)' },
];

interface StockAdjustDialogProps {
  open: boolean;
  onClose: () => void;
  stockLevel: StockLevel | null;
  onSubmit: (input: StockAdjustInput) => Promise<unknown>;
}

export function StockAdjustDialog({ open, onClose, stockLevel, onSubmit }: StockAdjustDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Adjust stock">
      {open && stockLevel !== null && (
        // Keyed by product so switching which row is being adjusted remounts the form with
        // clean state, instead of resetting state from an effect on prop change.
        <StockAdjustForm key={stockLevel.productId} stockLevel={stockLevel} onClose={onClose} onSubmit={onSubmit} />
      )}
    </Dialog>
  );
}

interface StockAdjustFormProps {
  stockLevel: StockLevel;
  onClose: () => void;
  onSubmit: (input: StockAdjustInput) => Promise<unknown>;
}

function StockAdjustForm({ stockLevel, onClose, onSubmit }: StockAdjustFormProps): React.JSX.Element {
  const [type, setType] = useState<ManualMovementType>('PURCHASE');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({ productId: stockLevel.productId, type, quantity, note: note.trim() === '' ? undefined : note });
      toast.success('Stock adjusted');
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
      <div>
        <p className="text-sm font-medium">{stockLevel.name}</p>
        <p className="text-xs text-muted-foreground">
          {stockLevel.sku} &middot; currently {stockLevel.quantity} on hand
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="adjust-type">Movement type</Label>
        <Select
          id="adjust-type"
          value={type}
          onChange={(event) => {
            setType(event.target.value as ManualMovementType);
          }}
        >
          {MOVEMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="adjust-quantity">Quantity</Label>
        <Input
          id="adjust-quantity"
          type="number"
          min={1}
          required
          value={quantity}
          onChange={(event) => {
            setQuantity(Number(event.target.value));
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="adjust-note">Note</Label>
        <Textarea
          id="adjust-note"
          placeholder="Why the stock moved"
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
          {isSubmitting ? 'Saving...' : 'Apply'}
        </Button>
      </div>
    </form>
  );
}
