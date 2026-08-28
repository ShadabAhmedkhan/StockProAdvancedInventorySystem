'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/error-message';
import type { AddPaymentInput } from '../api';
import { PAYMENT_METHOD_LABELS } from '../labels';
import type { PaymentMethod } from '../types';

const METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

interface AddPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  outstanding: string;
  onSubmit: (input: AddPaymentInput) => Promise<unknown>;
}

export function AddPaymentDialog({ open, onClose, outstanding, onSubmit }: AddPaymentDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Record a payment">
      {open && (
        // Keyed by `outstanding` so re-opening after the balance changes remounts with a clean form.
        <PaymentForm key={outstanding} outstanding={outstanding} onClose={onClose} onSubmit={onSubmit} />
      )}
    </Dialog>
  );
}

function PaymentForm({
  outstanding,
  onClose,
  onSubmit,
}: {
  outstanding: string;
  onClose: () => void;
  onSubmit: (input: AddPaymentInput) => Promise<unknown>;
}): React.JSX.Element {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState(outstanding);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({ method, amount, reference: reference.trim() === '' ? undefined : reference, note: note.trim() === '' ? undefined : note });
      toast.success('Payment recorded');
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
      <p className="text-xs text-muted-foreground">Outstanding balance: {outstanding}</p>

      <div className="space-y-1.5">
        <Label htmlFor="payment-method">Method</Label>
        <Select
          id="payment-method"
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
        <Label htmlFor="payment-amount">Amount</Label>
        <Input
          id="payment-amount"
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payment-reference">Reference</Label>
        <Input
          id="payment-reference"
          placeholder="Card authorisation, transfer id..."
          value={reference}
          onChange={(event) => {
            setReference(event.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payment-note">Note</Label>
        <Input
          id="payment-note"
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
          {isSubmitting ? 'Recording...' : 'Record payment'}
        </Button>
      </div>
    </form>
  );
}
