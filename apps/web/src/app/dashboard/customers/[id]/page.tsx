'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { Textarea } from '@/components/ui/textarea';
import { customersApi } from '@/features/customers/api';
import { REPAIR_STATUS_LABELS } from '@/features/repairs/labels';
import type { CreateCustomerAddressInput, CustomerAddress, UpdateCustomerAddressInput } from '@/features/customers/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const WRITE_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);

const TIMELINE_LABELS: Record<string, string> = { ORDER: 'Order', REPAIR: 'Repair', RETURN: 'Return', NOTE: 'Note' };

export default function CustomerDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const customerQuery = useQuery({ queryKey: ['customer', customerId], queryFn: () => customersApi.get(customerId) });
  const lifetimeQuery = useQuery({ queryKey: ['customer', customerId, 'lifetime-value'], queryFn: () => customersApi.lifetimeValue(customerId) });
  const outstandingQuery = useQuery({ queryKey: ['customer', customerId, 'outstanding'], queryFn: () => customersApi.outstanding(customerId) });
  const purchaseHistoryQuery = useQuery({ queryKey: ['customer', customerId, 'purchase-history'], queryFn: () => customersApi.purchaseHistory(customerId, 1) });
  const repairHistoryQuery = useQuery({ queryKey: ['customer', customerId, 'repair-history'], queryFn: () => customersApi.repairHistory(customerId, 1) });
  const notesQuery = useQuery({ queryKey: ['customer', customerId, 'notes'], queryFn: () => customersApi.notes(customerId) });
  const addressesQuery = useQuery({ queryKey: ['customer', customerId, 'addresses'], queryFn: () => customersApi.addresses(customerId) });
  const timelineQuery = useQuery({ queryKey: ['customer', customerId, 'timeline'], queryFn: () => customersApi.timeline(customerId) });

  const invalidate = (key?: string): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: key === undefined ? ['customer', customerId] : ['customer', customerId, key] });

  const [actionError, setActionError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(null);

  const updateTagsMutation = useMutation({ mutationFn: (tags: string[]) => customersApi.updateTags(customerId, tags) });
  const addNoteMutation = useMutation({ mutationFn: (body: string) => customersApi.addNote(customerId, body) });
  const addAddressMutation = useMutation({ mutationFn: (input: CreateCustomerAddressInput) => customersApi.addAddress(customerId, input) });
  const updateAddressMutation = useMutation({
    mutationFn: ({ addressId, input }: { addressId: string; input: UpdateCustomerAddressInput }) =>
      customersApi.updateAddress(customerId, addressId, input),
  });
  const removeAddressMutation = useMutation({ mutationFn: (addressId: string) => customersApi.removeAddress(customerId, addressId) });

  async function runAction(action: () => Promise<unknown>, key?: string): Promise<void> {
    setActionError(null);
    try {
      await action();
      await invalidate(key);
    } catch (submitError) {
      setActionError(errorMessage(submitError));
    }
  }

  if (customerQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  const customer = customerQuery.data;
  if (customerQuery.isError || customer === undefined) {
    return <p className="text-sm text-danger">{errorMessage(customerQuery.error)}</p>;
  }

  function addTag(): void {
    const tag = tagInput.trim();
    if (tag === '' || customer === undefined || customer.tags.includes(tag)) {
      setTagInput('');
      return;
    }
    void runAction(() => updateTagsMutation.mutateAsync([...customer.tags, tag]));
    setTagInput('');
  }

  function removeTag(tag: string): void {
    if (customer === undefined) return;
    void runAction(() => updateTagsMutation.mutateAsync(customer.tags.filter((existing) => existing !== tag)));
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/customers" className="text-sm text-muted-foreground hover:underline">
          &larr; Back to customers
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">
            {customer.firstName} {customer.lastName}
          </h1>
          <span className="font-mono text-xs text-muted-foreground">{customer.customerCode}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {customer.phone}
          {customer.email !== null && ` · ${customer.email}`}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {customer.tags.map((tag) => (
            <Badge key={tag} className="bg-muted text-muted-foreground">
              {tag}
              {canWrite && (
                <button
                  type="button"
                  className="ml-1 hover:text-foreground"
                  onClick={() => {
                    removeTag(tag);
                  }}
                  aria-label={`Remove ${tag}`}
                >
                  &times;
                </button>
              )}
            </Badge>
          ))}
          {canWrite && (
            <Input
              placeholder="Add tag"
              value={tagInput}
              onChange={(event) => {
                setTagInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addTag();
                }
              }}
              className="h-6 w-28 text-xs"
            />
          )}
        </div>
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Lifetime value</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {lifetimeQuery.data === undefined ? '-' : formatCurrency(lifetimeQuery.data.total)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Outstanding</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {outstandingQuery.data === undefined
              ? '-'
              : formatCurrency(
                  (
                    outstandingQuery.data.orders.reduce((sum, order) => sum + Number(order.outstanding), 0) +
                    outstandingQuery.data.repairs.reduce((sum, repair) => sum + Number(repair.outstanding ?? 0), 0)
                  ).toFixed(2),
                )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {purchaseHistoryQuery.isLoading && <TableSkeleton />}
          {purchaseHistoryQuery.isError && <p className="p-4 text-sm text-danger">{errorMessage(purchaseHistoryQuery.error)}</p>}
          {purchaseHistoryQuery.data !== undefined &&
            (purchaseHistoryQuery.data.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {purchaseHistoryQuery.data.items.map((order) => (
                    <tr key={order.id} className="border-b border-border last:border-0">
                      <td className="p-3">
                        <Link href={`/dashboard/orders/${order.id}`} className="font-medium hover:underline">
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="p-3 text-muted-foreground">{formatDateTime(order.createdAt)}</td>
                      <td className="p-3 text-right tabular-nums">{formatCurrency(order.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Repair history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {repairHistoryQuery.isLoading && <TableSkeleton />}
          {repairHistoryQuery.isError && <p className="p-4 text-sm text-danger">{errorMessage(repairHistoryQuery.error)}</p>}
          {repairHistoryQuery.data !== undefined &&
            (repairHistoryQuery.data.items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No repairs yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {repairHistoryQuery.data.items.map((repair) => (
                    <tr key={repair.id} className="border-b border-border last:border-0">
                      <td className="p-3">
                        <Link href={`/dashboard/repairs/${repair.id}`} className="font-medium hover:underline">
                          {repair.repairNumber}
                        </Link>
                      </td>
                      <td className="p-3 text-muted-foreground">{REPAIR_STATUS_LABELS[repair.status]}</td>
                      <td className="p-3 text-muted-foreground">{formatDateTime(repair.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notesQuery.isLoading && <TableSkeleton rows={2} />}
          {notesQuery.isError && <p className="text-sm text-danger">{errorMessage(notesQuery.error)}</p>}
          {notesQuery.data !== undefined && (
            <ul className="space-y-2 text-sm">
              {notesQuery.data.length === 0 && <p className="text-muted-foreground">No notes yet.</p>}
              {notesQuery.data.map((note) => (
                <li key={note.id} className="border-b border-border pb-2 last:border-0">
                  <p>{note.body}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(note.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <div className="flex gap-2">
              <Textarea
                value={noteBody}
                placeholder="Add a note"
                onChange={(event) => {
                  setNoteBody(event.target.value);
                }}
              />
              <Button
                disabled={noteBody.trim() === '' || addNoteMutation.isPending}
                onClick={() => {
                  void runAction(async () => {
                    await addNoteMutation.mutateAsync(noteBody);
                    setNoteBody('');
                  }, 'notes');
                }}
              >
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Addresses</CardTitle>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingAddress(null);
                setAddressDialogOpen(true);
              }}
            >
              Add address
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {addressesQuery.isLoading && <TableSkeleton rows={2} />}
          {addressesQuery.isError && <p className="text-sm text-danger">{errorMessage(addressesQuery.error)}</p>}
          {addressesQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No saved addresses.</p>
          )}
          {addressesQuery.data?.map((address) => (
            <div key={address.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 text-sm last:border-0">
              <div>
                <p className="font-medium">
                  {address.label}
                  {address.isDefault && (
                    <Badge className="ml-2 bg-success/15 text-success" aria-label="Default address">
                      Default
                    </Badge>
                  )}
                </p>
                <p className="text-muted-foreground">
                  {address.line1}
                  {address.line2 !== null && `, ${address.line2}`}, {address.city}, {address.state} {address.postalCode}, {address.country}
                </p>
              </div>
              {canWrite && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingAddress(address);
                      setAddressDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  {!address.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void runAction(() => updateAddressMutation.mutateAsync({ addressId: address.id, input: { isDefault: true } }), 'addresses');
                      }}
                    >
                      Make default
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void runAction(() => removeAddressMutation.mutateAsync(address.id), 'addresses');
                    }}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineQuery.isLoading && <TableSkeleton rows={4} />}
          {timelineQuery.isError && <p className="text-sm text-danger">{errorMessage(timelineQuery.error)}</p>}
          {timelineQuery.data !== undefined && (
            <ul className="space-y-2 text-sm">
              {timelineQuery.data.length === 0 && <p className="text-muted-foreground">Nothing here yet.</p>}
              {timelineQuery.data.map((entry) => (
                <li key={`${entry.type}-${entry.id}`} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
                  <div>
                    <span className="mr-2 text-xs font-medium text-muted-foreground">{TIMELINE_LABELS[entry.type]}</span>
                    {entry.summary}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(entry.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddressDialog
        open={addressDialogOpen}
        address={editingAddress}
        onClose={() => {
          setAddressDialogOpen(false);
        }}
        onSubmit={async (input) => {
          if (editingAddress === null) {
            await addAddressMutation.mutateAsync(input);
          } else {
            await updateAddressMutation.mutateAsync({ addressId: editingAddress.id, input });
          }
          await invalidate('addresses');
          setAddressDialogOpen(false);
        }}
      />
    </div>
  );
}

function AddressDialog({
  open,
  address,
  onClose,
  onSubmit,
}: {
  open: boolean;
  address: CustomerAddress | null;
  onClose: () => void;
  onSubmit: (input: CreateCustomerAddressInput) => Promise<void>;
}): React.JSX.Element {
  const [values, setValues] = useState<CreateCustomerAddressInput>(addressToInput(address));
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [key, setKey] = useState(address?.id ?? 'new');

  // Reset form fields whenever a different address (or "new") is opened.
  if (key !== (address?.id ?? 'new')) {
    setKey(address?.id ?? 'new');
    setValues(addressToInput(address));
    setFormError(null);
  }

  return (
    <Dialog open={open} onClose={onClose} title={address === null ? 'Add address' : 'Edit address'}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setFormError(null);
          setSubmitting(true);
          onSubmit(values)
            .catch((submitError: unknown) => {
              setFormError(errorMessage(submitError));
            })
            .finally(() => {
              setSubmitting(false);
            });
        }}
        className="space-y-3"
      >
        {(
          [
            ['label', 'Label'],
            ['line1', 'Address line 1'],
            ['line2', 'Address line 2'],
            ['city', 'City'],
            ['state', 'State'],
            ['postalCode', 'Postal code'],
            ['country', 'Country'],
          ] as const
        ).map(([name, label]) => (
          <div key={name} className="space-y-1.5">
            <Label htmlFor={name}>{label}</Label>
            <Input
              id={name}
              required={name !== 'line2'}
              value={values[name] ?? ''}
              onChange={(event) => {
                setValues((current) => ({ ...current, [name]: event.target.value }));
              }}
            />
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={values.isDefault ?? false}
            onChange={(event) => {
              setValues((current) => ({ ...current, isDefault: event.target.checked }));
            }}
          />
          Default address
        </label>

        {formError !== null && <p className="text-sm text-danger">{formError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function addressToInput(address: CustomerAddress | null): CreateCustomerAddressInput {
  return address === null
    ? { label: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: '', isDefault: false }
    : {
        label: address.label,
        line1: address.line1,
        line2: address.line2 ?? '',
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
        isDefault: address.isDefault,
      };
}
