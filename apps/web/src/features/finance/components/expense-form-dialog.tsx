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
import type { CreateExpenseInput, UpdateExpenseInput } from '../api';
import { EXPENSE_CATEGORY_LABELS } from '../labels';
import type { Expense, ExpenseCategory } from '../types';

const CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

interface ExpenseFormDialogProps {
  open: boolean;
  onClose: () => void;
  editingExpense: Expense | null;
  onCreate: (input: CreateExpenseInput) => Promise<unknown>;
  onUpdate: (id: string, input: UpdateExpenseInput) => Promise<unknown>;
}

export function ExpenseFormDialog({ open, onClose, editingExpense, onCreate, onUpdate }: ExpenseFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={editingExpense === null ? 'Record an expense' : 'Edit expense'}>
      {open && <ExpenseForm key={editingExpense?.id ?? 'new'} editingExpense={editingExpense} onClose={onClose} onCreate={onCreate} onUpdate={onUpdate} />}
    </Dialog>
  );
}

function ExpenseForm({
  editingExpense,
  onClose,
  onCreate,
  onUpdate,
}: {
  editingExpense: Expense | null;
  onClose: () => void;
  onCreate: (input: CreateExpenseInput) => Promise<unknown>;
  onUpdate: (id: string, input: UpdateExpenseInput) => Promise<unknown>;
}): React.JSX.Element {
  const [category, setCategory] = useState<ExpenseCategory>(editingExpense?.category ?? 'OTHER');
  const [description, setDescription] = useState(editingExpense?.description ?? '');
  const [amount, setAmount] = useState(editingExpense?.amount ?? '');
  const [expenseDate, setExpenseDate] = useState(editingExpense?.expenseDate.slice(0, 10) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const input = { category, description, amount, expenseDate: expenseDate === '' ? undefined : expenseDate };
      if (editingExpense === null) {
        await onCreate(input);
        toast.success('Expense recorded');
      } else {
        await onUpdate(editingExpense.id, input);
        toast.success('Expense updated');
      }
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
      <div className="space-y-1.5">
        <Label htmlFor="expense-category">Category *</Label>
        <Select
          id="expense-category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as ExpenseCategory);
          }}
        >
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {EXPENSE_CATEGORY_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expense-description">Description *</Label>
        <Textarea
          id="expense-description"
          required
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="expense-amount">Amount *</Label>
          <Input
            id="expense-amount"
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
          <Label htmlFor="expense-date">Date</Label>
          <Input
            id="expense-date"
            type="date"
            value={expenseDate}
            onChange={(event) => {
              setExpenseDate(event.target.value);
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
          {isSubmitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
