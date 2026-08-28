'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable, nextSortState, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { brandsApi, categoriesApi, productsApi, type ProductSortField } from '@/features/products/api';
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
  const [sortBy, setSortBy] = useState<ProductSortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

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
    queryKey: ['products', page, search, categoryId, brandId, includeDeleted, sortBy, sortOrder],
    queryFn: () => productsApi.list({ page, search, categoryId: categoryId || undefined, brandId: brandId || undefined, includeDeleted, sortBy, sortOrder }),
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
      toast.success('Product deleted');
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function handleRestore(id: string): Promise<void> {
    setActionError(null);
    try {
      await restoreMutation.mutateAsync(id);
      await invalidate();
      toast.success('Product restored');
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

  const columns: DataTableColumn<Product>[] = [
    { key: 'sku', label: 'SKU', sortable: true, render: (product) => <span className="font-mono text-xs">{product.sku}</span> },
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      render: (product) => (
        <>
          {product.name}
          {!product.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}
          {product.deletedAt !== null && <span className="ml-2 text-xs text-muted-foreground">(deleted)</span>}
        </>
      ),
    },
    { key: 'category', label: 'Category', render: (product) => <span className="text-muted-foreground">{product.category.name}</span> },
    { key: 'brand', label: 'Brand', render: (product) => <span className="text-muted-foreground">{product.brand?.name ?? '-'}</span> },
    { key: 'costPrice', label: 'Cost', align: 'right', sortable: true, render: (product) => <span className="tabular-nums">{formatCurrency(product.costPrice)}</span> },
    { key: 'sellingPrice', label: 'Price', align: 'right', sortable: true, render: (product) => <span className="tabular-nums">{formatCurrency(product.sellingPrice)}</span> },
    { key: 'onHand', label: 'On hand', align: 'right', render: (product) => <span className="tabular-nums">{product.inventory?.quantity ?? 0}</span> },
    {
      key: 'stock',
      label: 'Stock',
      render: (product) => <StockStatusBadge status={stockStatusFor(product.inventory?.quantity ?? 0, product.minimumStock)} />,
    },
    ...(canWrite
      ? [
          {
            key: 'actions',
            label: 'Actions',
            align: 'right' as const,
            render: (product: Product) => (
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
            ),
          },
        ]
      : []),
  ];

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

      {actionError !== null && <p className="text-sm text-danger">{actionError}</p>}

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(product) => product.id}
        isLoading={productsQuery.isLoading}
        isError={productsQuery.isError}
        error={productsQuery.error}
        emptyMessage="No products found."
        sort={{
          sortBy,
          sortOrder,
          onSortChange: (columnKey) => {
            const next = nextSortState({ sortBy, sortOrder }, columnKey);
            setSortBy(next.sortBy as ProductSortField);
            setSortOrder(next.sortOrder);
            setPage(1);
          },
        }}
        pagination={
          data === undefined
            ? undefined
            : {
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
                total: data.pagination.total,
                onPageChange: setPage,
              }
        }
      />

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
