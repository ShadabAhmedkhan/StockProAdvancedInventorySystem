'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { extendedTrialEnd } from '../labels';
import type { PlatformOrganizationSummary } from '../types';

const QUICK_PICKS = [7, 14, 30, 90] as const;
const MAX_DAYS = 365;

interface ExtendTrialDialogProps {
  open: boolean;
  onClose: () => void;
  organization: PlatformOrganizationSummary;
  onSubmit: (days: number) => Promise<PlatformOrganizationSummary>;
}

export function ExtendTrialDialog({ open, onClose, organization, onSubmit }: ExtendTrialDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={`Extend trial - ${organization.name}`}>
      {open && <ExtendTrialForm organization={organization} onClose={onClose} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function ExtendTrialForm({ organization, onClose, onSubmit }: Omit<ExtendTrialDialogProps, 'open'>): React.JSX.Element {
  const [days, setDays] = useState('14');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parsedDays = Number(days);
  const isValid = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= MAX_DAYS;

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!isValid) {
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await onSubmit(parsedDays);
      toast.success(`Trial extended - now ends ${formatDateTime(updated.trialEndsAt)}`);
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
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label>Quick pick</Label>
        <div className="flex flex-wrap gap-2">
          {QUICK_PICKS.map((pick) => (
            <Button
              key={pick}
              type="button"
              size="sm"
              variant={parsedDays === pick ? 'default' : 'outline'}
              onClick={() => {
                setDays(String(pick));
              }}
            >
              +{pick} days
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="trial-days">Days to add (1-{MAX_DAYS})</Label>
        <Input
          id="trial-days"
          type="number"
          min={1}
          max={MAX_DAYS}
          step={1}
          required
          value={days}
          onChange={(event) => {
            setDays(event.target.value);
          }}
        />
      </div>

      <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
        <p>
          <span className="text-muted-foreground">Current trial end: </span>
          {formatDateTime(organization.trialEndsAt)}
        </p>
        <p>
          <span className="text-muted-foreground">New trial end: </span>
          <span className="font-medium">{isValid ? formatDateTime(extendedTrialEnd(organization.trialEndsAt, parsedDays).toISOString()) : '-'}</span>
        </p>
        <p className="text-xs text-muted-foreground">Counted from the current end date, or from today if the trial has already ended.</p>
      </div>

      {organization.subscriptionStatus === 'SUSPENDED' && (
        <p className="text-xs text-warning">This organization stays suspended - reactivate it afterwards to restore access.</p>
      )}
      {(organization.subscriptionStatus === 'PAST_DUE' || organization.subscriptionStatus === 'CANCELED') && (
        <p className="text-xs text-warning">This moves the organization back to a trial and restores its access.</p>
      )}

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !isValid}>
          {isSubmitting ? 'Extending...' : 'Extend trial'}
        </Button>
      </div>
    </form>
  );
}
