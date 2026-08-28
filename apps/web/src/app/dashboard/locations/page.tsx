'use client';

import { EntityCrudPage } from '@/components/entity-crud/entity-crud-page';
import type { Column, FormField } from '@/components/entity-crud/types';
import { locationsApi } from '@/features/locations/api';
import type { Location } from '@/features/locations/types';
import { useAuth } from '@/hooks/use-auth';

const LOCATION_TYPE_LABELS: Record<string, string> = {
  STORE: 'Store',
  WAREHOUSE: 'Warehouse',
  SERVICE_CENTER: 'Service centre',
};

const COLUMNS: Column<Location>[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type', render: (location) => LOCATION_TYPE_LABELS[location.type] ?? location.type },
  { key: 'address', label: 'Address', render: (location) => location.address ?? '-' },
  { key: 'isDefault', label: 'Default', render: (location) => (location.isDefault ? 'Yes' : '') },
];

const FORM_FIELDS: FormField[] = [
  { name: 'name', label: 'Name', required: true, placeholder: 'Main Warehouse' },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    options: [
      { value: 'STORE', label: 'Store' },
      { value: 'WAREHOUSE', label: 'Warehouse' },
      { value: 'SERVICE_CENTER', label: 'Service centre' },
    ],
  },
  { name: 'address', label: 'Address', type: 'textarea' },
];

/** Locations are org-admin master data - writable and deletable only by ADMIN and MANAGER, matching `LocationsController`. */
const WRITE_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function LocationsPage(): React.JSX.Element {
  const { user } = useAuth();
  const role = user?.role ?? '';

  return (
    <EntityCrudPage
      title="Locations"
      description="Stores, warehouses and service centres stock is tracked against. The default location cannot be deleted."
      queryKey="locations"
      api={locationsApi}
      columns={COLUMNS}
      formFields={FORM_FIELDS}
      searchPlaceholder="Search by name"
      canWrite={WRITE_ROLES.has(role)}
      canDelete={WRITE_ROLES.has(role)}
    />
  );
}
