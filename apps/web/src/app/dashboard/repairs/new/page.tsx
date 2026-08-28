'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Customer } from '@/features/customers/types';
import { CustomerPicker } from '@/features/orders/components/customer-picker';
import { repairsApi, techniciansApi, type RepairIntakeInput } from '@/features/repairs/api';
import { DEVICE_TYPE_LABELS } from '@/features/repairs/labels';
import type { DeviceType } from '@/features/repairs/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';

const DEVICE_TYPES = Object.keys(DEVICE_TYPE_LABELS) as DeviceType[];
const CAN_VIEW_TECHNICIANS_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function RepairIntakePage(): React.JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const canViewTechnicians = CAN_VIEW_TECHNICIANS_ROLES.has(user?.role ?? '');

  const techniciansQuery = useQuery({ queryKey: ['technicians'], queryFn: techniciansApi.list, enabled: canViewTechnicians });
  const technicians = techniciansQuery.data?.items ?? [];

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [deviceType, setDeviceType] = useState<DeviceType>('PHONE');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [imei, setImei] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [expectedCompletionAt, setExpectedCompletionAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (customer === null) {
      setError('Choose the customer this device belongs to.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const input: RepairIntakeInput = {
        customerId: customer.id,
        deviceType,
        brand: brand.trim() === '' ? undefined : brand,
        model: model.trim() === '' ? undefined : model,
        serialNumber: serialNumber.trim() === '' ? undefined : serialNumber,
        imei: imei.trim() === '' ? undefined : imei,
        problemDescription,
        estimatedCost: estimatedCost.trim() === '' ? undefined : estimatedCost,
        technicianId: technicianId === '' ? undefined : technicianId,
        expectedCompletionAt: expectedCompletionAt === '' ? undefined : new Date(expectedCompletionAt).toISOString(),
        notes: notes.trim() === '' ? undefined : notes,
      };
      const repair = await repairsApi.create(input);
      toast.success('Repair intake recorded');
      router.push(`/dashboard/repairs/${repair.id}`);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Intake a device</h1>
        <p className="text-sm text-muted-foreground">Open a repair ticket for a customer's device.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label>Customer *</Label>
              {customer === null ? (
                <CustomerPicker onSelect={setCustomer} />
              ) : (
                <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <span>
                    {customer.firstName} {customer.lastName} &middot; {customer.phone}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCustomer(null);
                    }}
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="device-type">Device type *</Label>
                <Select
                  id="device-type"
                  value={deviceType}
                  onChange={(event) => {
                    setDeviceType(event.target.value as DeviceType);
                  }}
                >
                  {DEVICE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {DEVICE_TYPE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  value={brand}
                  onChange={(event) => {
                    setBrand(event.target.value);
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="serial">Serial number</Label>
                <Input
                  id="serial"
                  value={serialNumber}
                  onChange={(event) => {
                    setSerialNumber(event.target.value);
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="imei">IMEI</Label>
                <Input
                  id="imei"
                  value={imei}
                  onChange={(event) => {
                    setImei(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimated-cost">Estimated cost</Label>
                <Input
                  id="estimated-cost"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={estimatedCost}
                  onChange={(event) => {
                    setEstimatedCost(event.target.value);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="problem">What's wrong? *</Label>
              <Textarea
                id="problem"
                required
                value={problemDescription}
                onChange={(event) => {
                  setProblemDescription(event.target.value);
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {canViewTechnicians && (
                <div className="space-y-1.5">
                  <Label htmlFor="technician">Technician</Label>
                  <Select
                    id="technician"
                    value={technicianId}
                    onChange={(event) => {
                      setTechnicianId(event.target.value);
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
              <div className="space-y-1.5">
                <Label htmlFor="expected">Expected completion</Label>
                <Input
                  id="expected"
                  type="date"
                  value={expectedCompletionAt}
                  onChange={(event) => {
                    setExpectedCompletionAt(event.target.value);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                }}
              />
            </div>

            {error !== null && <p className="text-sm text-danger">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  router.push('/dashboard/repairs');
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Opening...' : 'Open repair'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
