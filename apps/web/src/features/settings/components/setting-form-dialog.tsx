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
import type { UpsertSettingInput } from '../api';
import type { Setting, SettingValueType } from '../types';

const VALUE_TYPES: SettingValueType[] = ['STRING', 'NUMBER', 'BOOLEAN', 'JSON'];

interface SettingFormDialogProps {
  open: boolean;
  onClose: () => void;
  editingSetting: Setting | null;
  onSubmit: (key: string, input: UpsertSettingInput) => Promise<unknown>;
}

export function SettingFormDialog({ open, onClose, editingSetting, onSubmit }: SettingFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={editingSetting === null ? 'New setting' : `Edit ${editingSetting.key}`}>
      {open && <SettingForm key={editingSetting?.key ?? 'new'} editingSetting={editingSetting} onClose={onClose} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function SettingForm({
  editingSetting,
  onClose,
  onSubmit,
}: {
  editingSetting: Setting | null;
  onClose: () => void;
  onSubmit: (key: string, input: UpsertSettingInput) => Promise<unknown>;
}): React.JSX.Element {
  const [key, setKey] = useState(editingSetting?.key ?? '');
  const [value, setValue] = useState(editingSetting?.value ?? '');
  const [valueType, setValueType] = useState<SettingValueType>(editingSetting?.valueType ?? 'STRING');
  const [description, setDescription] = useState(editingSetting?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(key, { value, valueType, description: description.trim() === '' ? undefined : description });
      toast.success('Setting saved');
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
        <Label htmlFor="setting-key">Key *</Label>
        <Input
          id="setting-key"
          required
          disabled={editingSetting !== null}
          placeholder="low_stock_threshold"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="setting-value">Value *</Label>
          <Input
            id="setting-value"
            required
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="setting-value-type">Type</Label>
          <Select
            id="setting-value-type"
            value={valueType}
            onChange={(event) => {
              setValueType(event.target.value as SettingValueType);
            }}
          >
            {VALUE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="setting-description">Description</Label>
        <Textarea
          id="setting-description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
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
