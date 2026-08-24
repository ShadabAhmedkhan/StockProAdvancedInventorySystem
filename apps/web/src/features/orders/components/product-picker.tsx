'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { productsApi } from '@/features/products/api';
import type { Product } from '@/features/products/types';
import { formatCurrency } from '@/lib/format';

interface ProductPickerProps {
  onSelect: (product: Product) => void;
}

/** Search-as-you-type add-item widget for the order builder: type a SKU or name, click a match to add it. */
export function ProductPicker({ onSelect }: ProductPickerProps): React.JSX.Element {
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
    queryKey: ['product-picker', search],
    queryFn: () => productsApi.list({ page: 1, search, includeDeleted: false }),
    enabled: search.trim() !== '',
  });

  const results = (data?.items ?? []).filter((product) => product.isActive);

  return (
    <div className="relative">
      <Input
        placeholder="Search products by SKU or name to add a line"
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
        }}
      />
      {search.trim() !== '' && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-background shadow-md">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No matching products.</p>
          ) : (
            results.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => {
                  onSelect(product);
                  setInput('');
                  setSearch('');
                }}
                className="flex w-full items-center justify-between gap-3 border-b border-border p-2 text-left text-sm last:border-0 hover:bg-muted"
              >
                <span>
                  <span className="font-medium">{product.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{product.sku}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatCurrency(product.sellingPrice)} &middot; {product.inventory?.quantity ?? 0} on hand
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
