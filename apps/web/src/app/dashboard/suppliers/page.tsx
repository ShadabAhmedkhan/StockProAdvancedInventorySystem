'use client';

import { EntityCrudPage } from '@/components/entity-crud/entity-crud-page';
import type { Column, FormField } from '@/components/entity-crud/types';
import { suppliersApi } from '@/features/suppliers/api';
import type { Supplier } from '@/features/suppliers/types';
import { useAuth } from '@/hooks/use-auth';

const COLUMNS: Column<Supplier>[] = [
  { key: 'supplierCode', label: 'Code' },
  { key: 'name', label: 'Name' },
  { key: 'contactPerson', label: 'Contact', render: (supplier) => supplier.contactPerson ?? '-' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email', render: (supplier) => supplier.email ?? '-' },
];

const FORM_FIELDS: FormField[] = [
  { name: 'supplierCode', label: 'Supplier code', required: true, placeholder: 'SUP-0001' },
  { name: 'name', label: 'Trading name', required: true },
  { name: 'contactPerson', label: 'Contact person' },
  { name: 'phone', label: 'Phone', required: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

/** Suppliers are purchasing master data - writable and deletable only by ADMIN and MANAGER, matching `SuppliersController`. */
const WRITE_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function SuppliersPage(): React.JSX.Element {
  const { user } = useAuth();
  const role = user?.role ?? '';

  return (
    <EntityCrudPage
      title="Suppliers"
      description="Vendors the shop purchases stock and parts from."
      queryKey="suppliers"
      api={suppliersApi}
      columns={COLUMNS}
      formFields={FORM_FIELDS}
      searchPlaceholder="Search by name, phone or email"
      canWrite={WRITE_ROLES.has(role)}
      canDelete={WRITE_ROLES.has(role)}
    />
  );
}
