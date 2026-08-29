'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { NOTIFICATION_TYPE_LABELS } from '@/features/notifications/labels';
import type { NotificationType } from '@/features/notifications/types';
import { errorMessage } from '@/lib/error-message';
import type { AutomationRuleInput } from '../api';
import { CONDITION_OPERATOR_LABELS, TRIGGER_FIELDS } from '../labels';
import { AUTOMATION_TRIGGER_TYPES, type AutomationCondition, type AutomationRule, type ConditionOperator, type UserRole } from '../types';

const ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'STAFF', 'TECHNICIAN'];
const OPERATORS: ConditionOperator[] = ['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN'];

interface AutomationRuleDialogProps {
  open: boolean;
  onClose: () => void;
  rule: AutomationRule | null;
  onSubmit: (input: AutomationRuleInput) => Promise<unknown>;
}

export function AutomationRuleDialog({ open, onClose, rule, onSubmit }: AutomationRuleDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={rule === null ? 'New automation rule' : 'Edit automation rule'} className="max-w-lg">
      {open && <RuleForm key={rule?.id ?? 'new'} rule={rule} onClose={onClose} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function RuleForm({
  rule,
  onClose,
  onSubmit,
}: {
  rule: AutomationRule | null;
  onClose: () => void;
  onSubmit: (input: AutomationRuleInput) => Promise<unknown>;
}): React.JSX.Element {
  const [name, setName] = useState(rule?.name ?? '');
  const [triggerType, setTriggerType] = useState<NotificationType>(rule?.triggerType ?? AUTOMATION_TRIGGER_TYPES[0] ?? 'LOW_STOCK');
  const [conditions, setConditions] = useState<AutomationCondition[]>(rule?.conditions ?? []);
  const [actionRoles, setActionRoles] = useState<UserRole[]>(rule?.actionRoles ?? []);
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableFields = TRIGGER_FIELDS[triggerType] ?? [];

  function addCondition(): void {
    setConditions((current) => [...current, { field: availableFields[0] ?? '', operator: 'EQUALS', value: '' }]);
  }

  function updateCondition(index: number, patch: Partial<AutomationCondition>): void {
    setConditions((current) => current.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)));
  }

  function removeCondition(index: number): void {
    setConditions((current) => current.filter((_, i) => i !== index));
  }

  function toggleRole(role: UserRole): void {
    setActionRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));
  }

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (actionRoles.length === 0) {
      setError('Select at least one role to notify.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({ name, triggerType, conditions, actionRoles, isActive });
      toast.success(rule === null ? 'Automation rule created' : 'Automation rule updated');
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
        <Label htmlFor="rule-name">Name</Label>
        <Input
          id="rule-name"
          required
          placeholder="Notify manager on laptop low stock"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rule-trigger">WHEN</Label>
        <Select
          id="rule-trigger"
          value={triggerType}
          onChange={(event) => {
            setTriggerType(event.target.value as NotificationType);
            setConditions([]);
          }}
        >
          {AUTOMATION_TRIGGER_TYPES.map((type) => (
            <option key={type} value={type}>
              {NOTIFICATION_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">IF (all must match; leave empty to always fire)</p>
          <Button type="button" variant="outline" size="sm" onClick={addCondition}>
            Add condition
          </Button>
        </div>
        {conditions.map((condition, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={condition.field}
              onChange={(event) => {
                updateCondition(index, { field: event.target.value });
              }}
              className="max-w-40"
            >
              {availableFields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </Select>
            <Select
              value={condition.operator}
              onChange={(event) => {
                updateCondition(index, { operator: event.target.value as ConditionOperator });
              }}
              className="max-w-44"
            >
              {OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {CONDITION_OPERATOR_LABELS[operator]}
                </option>
              ))}
            </Select>
            <Input
              value={condition.value}
              onChange={(event) => {
                updateCondition(index, { value: event.target.value });
              }}
              placeholder="value"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                removeCondition(index);
              }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">THEN notify</p>
        <div className="flex flex-wrap gap-3">
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={actionRoles.includes(role)}
                onChange={() => {
                  toggleRole(role);
                }}
              />
              {role}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => {
            setIsActive(event.target.checked);
          }}
        />
        Active
      </label>

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
