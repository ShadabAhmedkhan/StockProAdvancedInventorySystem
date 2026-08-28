'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/error-message';
import type { ProductInput } from '../api';
import type { Brand, Category, Product } from '../types';

interface ProductFormDialogProps {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  categories: Category[];
  brands: Brand[];
  onSubmit: (input: ProductInput) => Promise<unknown>;
}

function defaultValues(product: Product | null): ProductInput {
  if (product === null) {
    return {
      sku: '',
      barcode: '',
      name: '',
      description: '',
      categoryId: '',
      brandId: '',
      costPrice: '',
      sellingPrice: '',
      minimumStock: 0,
      isActive: true,
      trackingType: 'NONE',
      model: '',
      variant: '',
      color: '',
      storage: '',
      condition: 'NEW',
      warrantyMonths: undefined,
    };
  }
  return {
    sku: product.sku,
    barcode: product.barcode ?? '',
    name: product.name,
    description: product.description ?? '',
    categoryId: product.categoryId,
    brandId: product.brandId ?? '',
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    minimumStock: product.minimumStock,
    isActive: product.isActive,
    trackingType: product.trackingType,
    model: product.model ?? '',
    variant: product.variant ?? '',
    color: product.color ?? '',
    storage: product.storage ?? '',
    condition: product.condition,
    warrantyMonths: product.warrantyMonths ?? undefined,
  };
}

export function ProductFormDialog({ open, onClose, product, categories, brands, onSubmit }: ProductFormDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} title={product === null ? 'New product' : 'Edit product'} className="max-w-lg">
      {open && (
        // Keyed by identity so opening for a different product (or a fresh "New") remounts the
        // form with clean state, instead of resetting state from an effect on prop change.
        <ProductForm key={product?.id ?? 'new'} product={product} categories={categories} brands={brands} onClose={onClose} onSubmit={onSubmit} />
      )}
    </Dialog>
  );
}

interface ProductFormProps {
  product: Product | null;
  categories: Category[];
  brands: Brand[];
  onClose: () => void;
  onSubmit: (input: ProductInput) => Promise<unknown>;
}

function ProductForm({ product, categories, brands, onClose, onSubmit }: ProductFormProps): React.JSX.Element {
  const [values, setValues] = useState<ProductInput>(defaultValues(product));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(values);
      toast.success(product === null ? 'Product created' : 'Product updated');
      onClose();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  function set<K extends keyof ProductInput>(key: K, value: ProductInput[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU *</Label>
          <Input
            id="sku"
            required
            placeholder="ABC-123"
            value={values.sku}
            onChange={(event) => {
              set('sku', event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="barcode">Barcode</Label>
          <Input
            id="barcode"
            value={values.barcode}
            onChange={(event) => {
              set('barcode', event.target.value);
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          required
          value={values.name}
          onChange={(event) => {
            set('name', event.target.value);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={values.description}
          onChange={(event) => {
            set('description', event.target.value);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="categoryId">Category *</Label>
          <Select
            id="categoryId"
            required
            value={values.categoryId}
            onChange={(event) => {
              set('categoryId', event.target.value);
            }}
          >
            <option value="" disabled>
              Select a category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="brandId">Brand</Label>
          <Select
            id="brandId"
            value={values.brandId}
            onChange={(event) => {
              set('brandId', event.target.value);
            }}
          >
            <option value="">No brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="costPrice">Cost price *</Label>
          <Input
            id="costPrice"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={values.costPrice}
            onChange={(event) => {
              set('costPrice', event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sellingPrice">Selling price *</Label>
          <Input
            id="sellingPrice"
            required
            inputMode="decimal"
            placeholder="0.00"
            value={values.sellingPrice}
            onChange={(event) => {
              set('sellingPrice', event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="minimumStock">Reorder level</Label>
          <Input
            id="minimumStock"
            type="number"
            min={0}
            value={values.minimumStock}
            onChange={(event) => {
              set('minimumStock', Number(event.target.value));
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="model">Model</Label>
          <Input
            id="model"
            value={values.model}
            onChange={(event) => {
              set('model', event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="variant">Variant</Label>
          <Input
            id="variant"
            value={values.variant}
            onChange={(event) => {
              set('variant', event.target.value);
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="color">Color</Label>
          <Input
            id="color"
            value={values.color}
            onChange={(event) => {
              set('color', event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="storage">Storage</Label>
          <Input
            id="storage"
            value={values.storage}
            onChange={(event) => {
              set('storage', event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="condition">Condition</Label>
          <Select
            id="condition"
            value={values.condition}
            onChange={(event) => {
              set('condition', event.target.value as ProductInput['condition']);
            }}
          >
            <option value="NEW">New</option>
            <option value="USED">Used</option>
            <option value="REFURBISHED">Refurbished</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="trackingType">Unit tracking</Label>
          <Select
            id="trackingType"
            value={values.trackingType}
            onChange={(event) => {
              set('trackingType', event.target.value as ProductInput['trackingType']);
            }}
          >
            <option value="NONE">None</option>
            <option value="SERIAL">Serial number</option>
            <option value="IMEI">IMEI</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="warrantyMonths">Warranty (months)</Label>
          <Input
            id="warrantyMonths"
            type="number"
            min={0}
            value={values.warrantyMonths ?? ''}
            onChange={(event) => {
              set('warrantyMonths', event.target.value === '' ? undefined : Number(event.target.value));
            }}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(event) => {
            set('isActive', event.target.checked);
          }}
        />
        Active in the catalogue
      </label>

      {error !== null && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
