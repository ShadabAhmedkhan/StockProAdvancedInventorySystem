'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/error-message';
import type { CreateUserInput, UpdateUserInput } from '../api';
import { USER_ROLE_LABELS, USER_STATUS_LABELS } from '../labels';
import type { AppUser, UserRole, UserStatus } from '../types';

const ROLES = Object.keys(USER_ROLE_LABELS) as UserRole[];
const STATUSES = Object.keys(USER_STATUS_LABELS) as UserStatus[];

interface UserFormDialogProps {
  open: boolean;
  onClose: () => void;
  editingUser: AppUser | null;
  onCreate: (input: CreateUserInput) => Promise<unknown>;
  onUpdate: (id: string, input: UpdateUserInput) => Promise<unknown>;
}

export function UserFormDialog({ open, onClose, editingUser, onCreate, onUpdate }: UserFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={editingUser === null ? 'Create a user' : 'Edit user'}>
      {open && <UserForm key={editingUser?.id ?? 'new'} editingUser={editingUser} onClose={onClose} onCreate={onCreate} onUpdate={onUpdate} />}
    </Dialog>
  );
}

function UserForm({
  editingUser,
  onClose,
  onCreate,
  onUpdate,
}: {
  editingUser: AppUser | null;
  onClose: () => void;
  onCreate: (input: CreateUserInput) => Promise<unknown>;
  onUpdate: (id: string, input: UpdateUserInput) => Promise<unknown>;
}): React.JSX.Element {
  const [firstName, setFirstName] = useState(editingUser?.firstName ?? '');
  const [lastName, setLastName] = useState(editingUser?.lastName ?? '');
  const [email, setEmail] = useState(editingUser?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(editingUser?.role ?? 'STAFF');
  const [status, setStatus] = useState<UserStatus>(editingUser?.status ?? 'ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (editingUser === null) {
        await onCreate({ firstName, lastName, email, password, role, status });
        toast.success('User created');
      } else {
        await onUpdate(editingUser.id, { firstName, lastName, email });
        toast.success('User updated');
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="user-first-name">First name *</Label>
          <Input
            id="user-first-name"
            required
            value={firstName}
            onChange={(event) => {
              setFirstName(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-last-name">Last name *</Label>
          <Input
            id="user-last-name"
            required
            value={lastName}
            onChange={(event) => {
              setLastName(event.target.value);
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-email">Email *</Label>
        <Input
          id="user-email"
          type="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>

      {editingUser === null && (
        <div className="space-y-1.5">
          <Label htmlFor="user-password">Password *</Label>
          <Input
            id="user-password"
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">At least 10 characters, with an upper-case letter, a lower-case letter and a digit.</p>
        </div>
      )}

      {editingUser === null && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="user-role">Role</Label>
            <Select
              id="user-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as UserRole);
              }}
            >
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {USER_ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-status">Status</Label>
            <Select
              id="user-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as UserStatus);
              }}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {USER_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

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
