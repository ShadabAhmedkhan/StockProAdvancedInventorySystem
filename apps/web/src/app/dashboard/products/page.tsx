'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { brandsApi, categoriesApi, productsApi } from '@/features/products/api';
import { ProductFormDialog } from '@/features/products/components/product-form-dialog';
import { StockStatusBadge } from '@/features/products/components/stock-status-badge';
import { stockStatusFor } from '@/features/products/labels';
import type { Product } from '@/features/products/types';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/error-message';
import { formatCurrency } from '@/lib/format';

const WRITE_ROLES = new Set(['ADMIN', 'MANAGER']);

export default function ProductsPage(): React.JSX.Element {
  const { user } = useAuth();
  const canWrite = WRITE_ROLES.has(user?.role ?? '');
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const brandsQuery = useQuery({ queryKey: ['brands'], queryFn: brandsApi.list });
  const categories = categoriesQuery.data?.items ?? [];
  const brands = brandsQuery.data?.items ?? [];

  const productsQuery = useQuery({
    queryKey: ['products', page, search, categoryId, brandId, includeDeleted],
    queryFn: () => productsApi.list({ page, search, categoryId: categoryId || undefined, brandId: brandId || undefined, includeDeleted }),
  });

  const invalidate = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['products'] });

  const removeMutation = useMutation({ mutationFn: productsApi.remove });
  const restoreMutation = useMutation({ mutationFn: productsApi.restore });
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleRemove(id: string): Promise<void> {
    setActionError(null);
    try {
      await removeMutation.mutateAsync(id);
      await invalidate();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function handleRestore(id: string): Promise<void> {
    setActionError(null);
    try {
      await restoreMutation.mutateAsync(id);
      await invalidate();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function openCreate(): void {
    setEditingProduct(null);
    setDialogOpen(true);
  }

  function openEdit(product: Product): void {
    setEditingProduct(product);
    setDialogOpen(true);
  }

  const data = productsQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Products</h1>
          <p className="text-sm text-muted-foreground">The full catalogue, priced and categorised.</p>
        </div>
        {canWrite && <Button onClick={openCreate}>New product</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by SKU, name or barcode"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setPage(1);
          }}
          className="max-w-48"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select
          value={brandId}
          onChange={(event) => {
            setBrandId(event.target.value);
            setPage(1);
          }}
          className="max-w-48"
        >
          <option value="">All brands</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => {
              setIncludeDeleted(event.target.checked);
              setPage(1);
            }}
          />
          Show deleted
        </label>
      </div>

      {actionError !== null && <p className="text-sm text-red-600">{actionError}</p>}

      <Card>
        <CardContent className="p-0">
          {productsQuery.isLoading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
          {productsQuery.isError && <p className="p-4 text-sm text-red-600">{errorMessage(productsQuery.error)}</p>}
          {data !== undefined && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">SKU</th>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Category</th>
                    <th className="p-3 font-medium">Brand</th>
                    <th className="p-3 text-right font-medium">Cost</th>
                    <th className="p-3 text-right font-medium">Price</th>
                    <th className="p-3 text-right font-medium">On hand</th>
                    <th className="p-3 font-medium">Stock</th>
                    {canWrite && <th className="p-3 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-muted-foreground">
                        No products found.
                      </td>
                    </tr>
                  )}
                  {data.items.map((product) => {
                    const quantity = product.inventory?.quantity ?? 0;
                    return (
                      <tr key={product.id} className="border-b border-border last:border-0">
                        <td className="p-3 font-mono text-xs">{product.sku}</td>
                        <td className="p-3">
                          {product.name}
                          {!product.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}
                          {product.deletedAt !== null && <span className="ml-2 text-xs text-muted-foreground">(deleted)</span>}
                        </td>
                        <td className="p-3 text-muted-foreground">{product.category.name}</td>
                        <td className="p-3 text-muted-foreground">{product.brand?.name ?? '-'}</td>
                        <td className="p-3 text-right tabular-nums">{formatCurrency(product.costPrice)}</td>
                        <td className="p-3 text-right tabular-nums">{formatCurrency(product.sellingPrice)}</td>
                        <td className="p-3 text-right tabular-nums">{quantity}</td>
                        <td className="p-3">
                          <StockStatusBadge status={stockStatusFor(quantity, product.minimumStock)} />
                        </td>
                        {canWrite && (
                          <td className="p-3 text-right">
                            <div className="flex justify-end gap-2">
                              {product.deletedAt === null && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    openEdit(product);
                                  }}
                                >
                                  Edit
                                </Button>
                              )}
                              {product.deletedAt === null ? (
                                <Button variant="outline" size="sm" onClick={() => void handleRemove(product.id)}>
                                  Delete
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" onClick={() => void handleRestore(product.id)}>
                                  Restore
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data !== undefined && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {data.pagination.page} of {data.pagination.totalPages} &middot; {data.pagination.total} total
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => {
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ProductFormDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
        }}
        product={editingProduct}
        categories={categories}
        brands={brands}
        onSubmit={async (input) => {
          if (editingProduct === null) {
            await productsApi.create(input);
          } else {
            await productsApi.update(editingProduct.id, input);
          }
          await invalidate();
        }}
      />
    </div>
  );
}
