'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { customersApi } from '@/features/customers/api';
import type { Customer } from '@/features/customers/types';

interface CustomerPickerProps {
  onSelect: (customer: Customer) => void;
}

export function CustomerPicker({ onSelect }: CustomerPickerProps): React.JSX.Element {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(input);
    }, 250);
    return () => {
      clearTimeout(timeout);
    };
  }, [input]);

  const { data } = useQuery({
    queryKey: ['customer-picker', search],
    queryFn: () => customersApi.list({ page: 1, search, includeDeleted: false }),
    enabled: search.trim() !== '',
  });

  const results = data?.items ?? [];

  return (
    <div className="relative">
      <Input
        placeholder="Search customers by name, phone or email"
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
        }}
      />
      {search.trim() !== '' && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-md">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No matching customers.</p>
          ) : (
            results.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => {
                  onSelect(customer);
                  setInput('');
                  setSearch('');
                }}
                className="flex w-full items-center justify-between gap-3 border-b border-border p-2 text-left text-sm last:border-0 hover:bg-muted"
              >
                <span className="font-medium">
                  {customer.firstName} {customer.lastName}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{customer.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
