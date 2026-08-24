'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/error-message';
import type { ChangeRepairStatusInput } from '../api';
import { REPAIR_STATUS_LABELS } from '../labels';
import { REPAIR_TRANSITIONS } from '../repair-status';
import type { RepairStatus } from '../types';

interface ChangeStatusDialogProps {
  open: boolean;
  onClose: () => void;
  currentStatus: RepairStatus;
  onSubmit: (input: ChangeRepairStatusInput) => Promise<unknown>;
}

export function ChangeStatusDialog({ open, onClose, currentStatus, onSubmit }: ChangeStatusDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title="Move this repair">
      {open && (
        // Keyed by the status being moved from, so reopening after a move remounts with clean state.
        <ChangeStatusForm key={currentStatus} currentStatus={currentStatus} onClose={onClose} onSubmit={onSubmit} />
      )}
    </Dialog>
  );
}

function ChangeStatusForm({
  currentStatus,
  onClose,
  onSubmit,
}: {
  currentStatus: RepairStatus;
  onClose: () => void;
  onSubmit: (input: ChangeRepairStatusInput) => Promise<unknown>;
}): React.JSX.Element {
  const options = REPAIR_TRANSITIONS[currentStatus];
  const [toStatus, setToStatus] = useState<RepairStatus | ''>(options[0] ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (toStatus === '') {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({ toStatus, note: note.trim() === '' ? undefined : note });
      onClose();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">This repair is finished and cannot move any further.</p>;
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="status-to">New status</Label>
        <Select
          id="status-to"
          value={toStatus}
          onChange={(event) => {
            setToStatus(event.target.value as RepairStatus);
          }}
        >
          {options.map((status) => (
            <option key={status} value={status}>
              {REPAIR_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status-note">Note</Label>
        <Textarea
          id="status-note"
          placeholder="Why it moved"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Move'}
        </Button>
      </div>
    </form>
  );
}
