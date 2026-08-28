'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AddPaymentDialog } from '@/features/orders/components/add-payment-dialog';
import { ProductPicker } from '@/features/orders/components/product-picker';
import { PAYMENT_METHOD_LABELS } from '@/features/orders/labels';
import { repairsApi, techniciansApi } from '@/features/repairs/api';
import { ChangeStatusDialog } from '@/features/repairs/components/change-status-dialog';
import { RepairStatusBadge } from '@/features/repairs/components/repair-status-badge';
import { DEVICE_TYPE_LABELS, REPAIR_STATUS_LABELS } from '@/features/repairs/labels';
import { OPEN_REPAIR_STATUSES, PAYABLE_REPAIR_STATUSES } from '@/features/repairs/repair-status';
import type { RepairDetail } from '@/features/repairs/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency, formatDateTime } from '@/lib/format';

const UPDATE_ROLES = new Set(['ADMIN', 'MANAGER', 'TECHNICIAN']);
const PAYMENT_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);
const VIEW_TECHNICIANS_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function RepairDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const repairId = params.id;
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canUpdate = UPDATE_ROLES.has(role);
  const canRecordPayment = PAYMENT_ROLES.has(role);
  const canViewTechnicians = VIEW_TECHNICIANS_ROLES.has(role);
  const queryClient = useQueryClient();

  const { data: repair, isLoading, isError, error } = useQuery({ queryKey: ['repair', repairId], queryFn: () => repairsApi.get(repairId) });
  const techniciansQuery = useQuery({ queryKey: ['technicians'], queryFn: techniciansApi.list, enabled: canViewTechnicians });
  const technicians = techniciansQuery.data?.items ?? [];

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['repair', repairId] });

  const [actionError, setActionError] = useState<string | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const addItemMutation = useMutation({ mutationFn: (productId: string) => repairsApi.addItem(repairId, { productId, quantity: 1 }) });
  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) => repairsApi.updateItem(repairId, itemId, quantity),
  });
  const removeItemMutation = useMutation({ mutationFn: (itemId: string) => repairsApi.removeItem(repairId, itemId) });

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await action();
      await invalidate();
    } catch (submitError) {
      setActionError(errorMessage(submitError));
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (isError || repair === undefined) {
    return <p className="text-sm text-danger">{errorMessage(error)}</p>;
  }

  const isOpen = OPEN_REPAIR_STATUSES.includes(repair.status);
  const isTerminal = repair.status === 'DELIVERED' || repair.status === 'CANCELLED';
  const canTakePayment =
    canRecordPayment && PAYABLE_REPAIR_STATUSES.includes(repair.status) && repair.finalCost !== null && Number(repair.outstanding ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/repairs" className="text-sm text-muted-foreground hover:underline">
            &larr; Back to repairs
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{repair.repairNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <RepairStatusBadge status={repair.status} />
            <span className="text-sm text-muted-foreground">
              {DEVICE_TYPE_LABELS[repair.deviceType]}
              {repair.brand !== null && ` – ${repair.brand}`}
              {repair.model !== null && ` ${repair.model}`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {!isTerminal && (
            <Button
              onClick={() => {
                setStatusDialogOpen(true);
              }}
            >
              Move status
            </Button>
          )}
          {canTakePayment && (
            <Button
              variant="outline"
              onClick={() => {
                setPaymentDialogOpen(true);
              }}
            >
              Record payment
            </Button>
          )}
        </div>
      </div>

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Problem</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{repair.problemDescription}</p>
              {repair.diagnosis !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Diagnosis</p>
                  <p>{repair.diagnosis}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {canUpdate && (
            <Card>
              <CardHeader>
                <CardTitle>Work details</CardTitle>
              </CardHeader>
              <CardContent>
                <RepairUpdateForm
                  repair={repair}
                  technicians={technicians}
                  showTechnician={canViewTechnicians}
                  onSave={(input) => runAction(() => repairsApi.update(repairId, input))}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Parts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {repair.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No parts fitted yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Part</th>
                        <th className="pb-2 text-right font-medium">Qty</th>
                        <th className="pb-2 text-right font-medium">Unit price</th>
                        <th className="pb-2 text-right font-medium">Total</th>
                        {isOpen && canUpdate && <th className="pb-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {repair.items.map((item) => (
                        <tr key={item.id} className="border-b border-border last:border-0">
                          <td className="py-2">
                            {item.product.name}
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{item.product.sku}</span>
                          </td>
                          <td className="py-2 text-right">
                            {isOpen && canUpdate ? (
                              <Input
                                type="number"
                                min={1}
                                defaultValue={item.quantity}
                                className="ml-auto w-16 text-right"
                                onBlur={(event) => {
                                  const quantity = Number(event.target.value);
                                  if (quantity > 0 && quantity !== item.quantity) {
                                    void runAction(() => updateItemMutation.mutateAsync({ itemId: item.id, quantity }));
                                  }
                                }}
                              />
                            ) : (
                              item.quantity
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(item.unitPrice)}</td>
                          <td className="py-2 text-right tabular-nums">{formatCurrency(item.total)}</td>
                          {isOpen && canUpdate && (
                            <td className="py-2 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  void runAction(() => removeItemMutation.mutateAsync(item.id));
                                }}
                              >
                                Remove
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {isOpen && canUpdate && (
                <ProductPicker
                  onSelect={(product) => {
                    void runAction(() => addItemMutation.mutateAsync(product.id));
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {repair.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Method</th>
                      <th className="pb-2 font-medium">Reference</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repair.payments.map((payment) => (
                      <tr key={payment.id} className="border-b border-border last:border-0">
                        <td className="py-2 text-muted-foreground">{formatDateTime(payment.paidAt)}</td>
                        <td className="py-2">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                        <td className="py-2 text-muted-foreground">{payment.reference ?? '-'}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(payment.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status history</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {repair.statusHistory.map((entry) => (
                  <li key={entry.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
                    <div>
                      <p>{entry.fromStatus === null ? 'Received' : `${REPAIR_STATUS_LABELS[entry.fromStatus]} → ${REPAIR_STATUS_LABELS[entry.toStatus]}`}</p>
                      {entry.note !== null && <p className="text-xs text-muted-foreground">{entry.note}</p>}
                      <p className="text-xs text-muted-foreground">
                        {entry.changedBy.firstName} {entry.changedBy.lastName}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <SummaryRow label="Estimated cost" value={repair.estimatedCost === null ? '-' : formatCurrency(repair.estimatedCost)} />
              <SummaryRow label="Final cost" value={repair.finalCost === null ? 'Not set' : formatCurrency(repair.finalCost)} />
              <SummaryRow label="Parts total" value={formatCurrency(repair.partsTotal)} />
              <SummaryRow label="Paid" value={formatCurrency(repair.paidAmount)} />
              <SummaryRow label="Outstanding" value={repair.outstanding === null ? '-' : formatCurrency(repair.outstanding)} strong />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p>
                  {repair.customer.firstName} {repair.customer.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{repair.customer.phone}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Technician</p>
                <p>{repair.technician === null ? 'Unassigned' : `${repair.technician.firstName} ${repair.technician.lastName}`}</p>
              </div>
              {repair.serialNumber !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Serial number</p>
                  <p>{repair.serialNumber}</p>
                </div>
              )}
              {repair.imei !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">IMEI</p>
                  <p>{repair.imei}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Received</p>
                <p>{formatDateTime(repair.receivedAt)}</p>
              </div>
              {repair.expectedCompletionAt !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Expected completion</p>
                  <p>{formatDateTime(repair.expectedCompletionAt)}</p>
                </div>
              )}
              {repair.completedAt !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p>{formatDateTime(repair.completedAt)}</p>
                </div>
              )}
              {repair.notes !== null && (
                <div>
                  <p className="text-xs text-muted-foreground">Notes</p>
                  <p>{repair.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ChangeStatusDialog
        open={statusDialogOpen}
        onClose={() => {
          setStatusDialogOpen(false);
        }}
        currentStatus={repair.status}
        onSubmit={async (input) => {
          await repairsApi.changeStatus(repairId, input);
          await invalidate();
        }}
      />

      <AddPaymentDialog
        open={paymentDialogOpen}
        onClose={() => {
          setPaymentDialogOpen(false);
        }}
        outstanding={repair.outstanding ?? '0.00'}
        onSubmit={async (input) => {
          await repairsApi.addPayment(repairId, input);
          await invalidate();
        }}
      />
    </div>
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.JSX.Element {
  return (
    <div className={`flex justify-between ${strong === true ? 'font-semibold' : 'text-muted-foreground'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function RepairUpdateForm({
  repair,
  technicians,
  showTechnician,
  onSave,
}: {
  repair: RepairDetail;
  technicians: { id: string; firstName: string; lastName: string }[];
  showTechnician: boolean;
  onSave: (input: { diagnosis?: string; estimatedCost?: string; finalCost?: string; technicianId?: string; notes?: string }) => Promise<void>;
}): React.JSX.Element {
  const [diagnosis, setDiagnosis] = useState(repair.diagnosis ?? '');
  const [estimatedCost, setEstimatedCost] = useState(repair.estimatedCost ?? '');
  const [finalCost, setFinalCost] = useState(repair.finalCost ?? '');
  const [technicianId, setTechnicianId] = useState(repair.technicianId ?? '');

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="diagnosis">Diagnosis</Label>
        <Textarea
          id="diagnosis"
          value={diagnosis}
          onChange={(event) => {
            setDiagnosis(event.target.value);
          }}
          onBlur={() => {
            if (diagnosis !== (repair.diagnosis ?? '')) {
              void onSave({ diagnosis });
            }
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="estimated">Estimated cost</Label>
          <Input
            id="estimated"
            inputMode="decimal"
            value={estimatedCost}
            onChange={(event) => {
              setEstimatedCost(event.target.value);
            }}
            onBlur={() => {
              if (estimatedCost !== (repair.estimatedCost ?? '')) {
                void onSave({ estimatedCost });
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="final">Final cost</Label>
          <Input
            id="final"
            inputMode="decimal"
            value={finalCost}
            onChange={(event) => {
              setFinalCost(event.target.value);
            }}
            onBlur={() => {
              if (finalCost !== (repair.finalCost ?? '')) {
                void onSave({ finalCost });
              }
            }}
          />
        </div>
      </div>

      {showTechnician && (
        <div className="space-y-1.5">
          <Label htmlFor="assign-technician">Technician</Label>
          <Select
            id="assign-technician"
            value={technicianId}
            onChange={(event) => {
              const value = event.target.value;
              setTechnicianId(value);
              void onSave({ technicianId: value });
            }}
          >
            <option value="">Unassigned</option>
            {technicians.map((technician) => (
              <option key={technician.id} value={technician.id}>
                {technician.firstName} {technician.lastName}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
