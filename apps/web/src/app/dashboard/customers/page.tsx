'use client';

import Link from 'next/link';
import { EntityCrudPage } from '@/components/entity-crud/entity-crud-page';
import type { Column, FormField } from '@/components/entity-crud/types';
import { customersApi } from '@/features/customers/api';
import type { Customer } from '@/features/customers/types';
import { useAuth } from '@/hooks/use-auth';

const COLUMNS: Column<Customer>[] = [
  { key: 'customerCode', label: 'Code' },
  {
    key: 'name',
    label: 'Name',
    render: (customer) => (
      <Link href={`/dashboard/customers/${customer.id}`} className="font-medium hover:underline">
        {customer.firstName} {customer.lastName}
      </Link>
    ),
  },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email', render: (customer) => customer.email ?? '-' },
];

const FORM_FIELDS: FormField[] = [
  { name: 'customerCode', label: 'Customer code', required: true, placeholder: 'CUS-0001' },
  { name: 'firstName', label: 'First name', required: true },
  { name: 'lastName', label: 'Last name', required: true },
  { name: 'phone', label: 'Phone', required: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

/** Writable by ADMIN, MANAGER and STAFF; soft-delete restricted to ADMIN and MANAGER - matches `CustomersController`. */
const WRITE_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF']);
const DELETE_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function CustomersPage(): React.JSX.Element {
  const { user } = useAuth();
  const role = user?.role ?? '';

  return (
    <EntityCrudPage
      title="Customers"
      description="Everyone who has bought from or been served by the shop."
      queryKey="customers"
      api={customersApi}
      columns={COLUMNS}
      formFields={FORM_FIELDS}
      searchPlaceholder="Search by name, phone or email"
      canWrite={WRITE_ROLES.has(role)}
      canDelete={DELETE_ROLES.has(role)}
    />
  );
}
