'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import type { CreateOtherIncomeInput } from '../api';

interface RecordIncomeDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateOtherIncomeInput) => Promise<unknown>;
}

export function RecordIncomeDialog({ open, onClose, onSubmit }: RecordIncomeDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Record other income">
      {open && <RecordIncomeForm onClose={onClose} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function RecordIncomeForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: CreateOtherIncomeInput) => Promise<unknown> }): React.JSX.Element {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({ amount, description, occurredAt: occurredAt === '' ? undefined : occurredAt });
      toast.success('Income recorded');
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
      <p className="text-xs text-muted-foreground">For income that did not come from a sale, a repair or a return.</p>

      <div className="space-y-1.5">
        <Label htmlFor="income-description">Description *</Label>
        <Input
          id="income-description"
          required
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="income-amount">Amount *</Label>
          <Input
            id="income-amount"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="income-date">Date</Label>
          <Input
            id="income-date"
            type="date"
            value={occurredAt}
            onChange={(event) => {
              setOccurredAt(event.target.value);
            }}
          />
        </div>
      </div>

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Recording...' : 'Record income'}
        </Button>
      </div>
    </form>
  );
}
