import type { Prisma } from '../../src/generated/prisma/client';
import { StockMovementType, StockReferenceType } from '../../src/generated/prisma/enums';
import { daysAgo, prisma } from './client';

interface SeededCategory {
  name: string;
  slug: string;
  description: string;
}

const CATEGORIES: SeededCategory[] = [
  { name: 'Smartphones', slug: 'smartphones', description: 'Handsets sold new and refurbished' },
  { name: 'Tablets', slug: 'tablets', description: 'Tablets and e-readers' },
  { name: 'Laptops', slug: 'laptops', description: 'Notebooks and ultrabooks' },
  { name: 'Spare Parts', slug: 'spare-parts', description: 'Screens, batteries and internal components' },
  { name: 'Accessories', slug: 'accessories', description: 'Cases, cables, chargers and audio' },
];

const BRANDS: { name: string; slug: string }[] = [
  { name: 'Aureon', slug: 'aureon' },
  { name: 'Nimbus', slug: 'nimbus' },
  { name: 'Corvid', slug: 'corvid' },
  { name: 'Halcyon', slug: 'halcyon' },
  { name: 'Volta', slug: 'volta' },
  { name: 'Generic', slug: 'generic' },
];

interface SeededProduct {
  sku: string;
  barcode: string;
  name: string;
  categorySlug: string;
  brandSlug: string;
  costPrice: string;
  sellingPrice: string;
  minimumStock: number;
  /**
   * Opening stock. Zero and below-minimum values are deliberate so the
   * low-stock and out-of-stock views have real data to show.
   */
  openingStock: number;
}

const PRODUCTS: SeededProduct[] = [
  { sku: 'SPH-AUR-A12', barcode: '8901000000011', name: 'Aureon A12 128GB', categorySlug: 'smartphones', brandSlug: 'aureon', costPrice: '310.00', sellingPrice: '429.00', minimumStock: 5, openingStock: 24 },
  { sku: 'SPH-AUR-A12P', barcode: '8901000000028', name: 'Aureon A12 Pro 256GB', categorySlug: 'smartphones', brandSlug: 'aureon', costPrice: '455.00', sellingPrice: '629.00', minimumStock: 4, openingStock: 12 },
  { sku: 'SPH-NIM-N7', barcode: '8901000000035', name: 'Nimbus N7 64GB', categorySlug: 'smartphones', brandSlug: 'nimbus', costPrice: '148.00', sellingPrice: '215.00', minimumStock: 8, openingStock: 31 },
  { sku: 'SPH-COR-C5', barcode: '8901000000042', name: 'Corvid C5 128GB', categorySlug: 'smartphones', brandSlug: 'corvid', costPrice: '205.00', sellingPrice: '289.00', minimumStock: 6, openingStock: 3 },
  { sku: 'TAB-HAL-T10', barcode: '8901000000059', name: 'Halcyon Tab 10 WiFi', categorySlug: 'tablets', brandSlug: 'halcyon', costPrice: '178.00', sellingPrice: '249.00', minimumStock: 4, openingStock: 15 },
  { sku: 'TAB-NIM-P8', barcode: '8901000000066', name: 'Nimbus Pad 8', categorySlug: 'tablets', brandSlug: 'nimbus', costPrice: '122.00', sellingPrice: '179.00', minimumStock: 4, openingStock: 9 },
  { sku: 'LAP-COR-BK14', barcode: '8901000000073', name: 'Corvid Book 14 i5/16GB', categorySlug: 'laptops', brandSlug: 'corvid', costPrice: '640.00', sellingPrice: '879.00', minimumStock: 3, openingStock: 7 },
  { sku: 'LAP-HAL-AIR13', barcode: '8901000000080', name: 'Halcyon Air 13 i7/16GB', categorySlug: 'laptops', brandSlug: 'halcyon', costPrice: '790.00', sellingPrice: '1099.00', minimumStock: 2, openingStock: 4 },
  { sku: 'PRT-SCR-AUR12', barcode: '8901000000097', name: 'Aureon A12 OLED Screen', categorySlug: 'spare-parts', brandSlug: 'aureon', costPrice: '62.00', sellingPrice: '119.00', minimumStock: 10, openingStock: 40 },
  { sku: 'PRT-SCR-NIM7', barcode: '8901000000103', name: 'Nimbus N7 LCD Screen', categorySlug: 'spare-parts', brandSlug: 'nimbus', costPrice: '28.00', sellingPrice: '59.00', minimumStock: 10, openingStock: 6 },
  { sku: 'PRT-BAT-AUR12', barcode: '8901000000110', name: 'Aureon A12 Battery 4200mAh', categorySlug: 'spare-parts', brandSlug: 'aureon', costPrice: '17.50', sellingPrice: '39.00', minimumStock: 15, openingStock: 55 },
  { sku: 'PRT-BAT-NIM7', barcode: '8901000000127', name: 'Nimbus N7 Battery 3600mAh', categorySlug: 'spare-parts', brandSlug: 'nimbus', costPrice: '13.00', sellingPrice: '32.00', minimumStock: 15, openingStock: 0 },
  { sku: 'PRT-CAM-COR5', barcode: '8901000000134', name: 'Corvid C5 Rear Camera Module', categorySlug: 'spare-parts', brandSlug: 'corvid', costPrice: '24.00', sellingPrice: '54.00', minimumStock: 8, openingStock: 18 },
  { sku: 'PRT-CHG-USBC', barcode: '8901000000141', name: 'USB-C Charging Port Flex', categorySlug: 'spare-parts', brandSlug: 'generic', costPrice: '4.20', sellingPrice: '14.00', minimumStock: 25, openingStock: 120 },
  { sku: 'ACC-CSE-AUR12', barcode: '8901000000158', name: 'Aureon A12 Silicone Case', categorySlug: 'accessories', brandSlug: 'aureon', costPrice: '3.10', sellingPrice: '12.00', minimumStock: 20, openingStock: 86 },
  { sku: 'ACC-GLS-UNIV', barcode: '8901000000165', name: 'Universal Tempered Glass', categorySlug: 'accessories', brandSlug: 'generic', costPrice: '1.05', sellingPrice: '7.50', minimumStock: 50, openingStock: 240 },
  { sku: 'ACC-CBL-USBC2M', barcode: '8901000000172', name: 'USB-C Braided Cable 2m', categorySlug: 'accessories', brandSlug: 'volta', costPrice: '2.40', sellingPrice: '9.90', minimumStock: 40, openingStock: 175 },
  { sku: 'ACC-PWR-65W', barcode: '8901000000189', name: 'Volta 65W GaN Charger', categorySlug: 'accessories', brandSlug: 'volta', costPrice: '15.80', sellingPrice: '39.90', minimumStock: 12, openingStock: 44 },
  { sku: 'ACC-AUD-BUDS', barcode: '8901000000196', name: 'Volta Buds Wireless Earbuds', categorySlug: 'accessories', brandSlug: 'volta', costPrice: '18.00', sellingPrice: '49.00', minimumStock: 10, openingStock: 2 },
  { sku: 'ACC-PWB-10K', barcode: '8901000000202', name: 'Volta Powerbank 10000mAh', categorySlug: 'accessories', brandSlug: 'volta', costPrice: '11.60', sellingPrice: '29.90', minimumStock: 15, openingStock: 33 },
];

export interface SeededProductRecord {
  id: string;
  sku: string;
  sellingPrice: Prisma.Decimal;
  costPrice: Prisma.Decimal;
}

export interface SeededCatalog {
  products: Map<string, SeededProductRecord>;
  categoryCount: number;
  brandCount: number;
  productCount: number;
}

/**
 * Creates the catalogue and its opening stock.
 *
 * Opening stock is written as a PURCHASE movement alongside the Inventory row,
 * because the ledger must be able to account for every unit on hand.
 */
export async function seedCatalog(createdById: string): Promise<SeededCatalog> {
  const categories = await Promise.all(
    CATEGORIES.map((category) =>
      prisma.category.upsert({
        where: { slug: category.slug },
        update: { name: category.name, description: category.description },
        create: category,
        select: { id: true, slug: true },
      }),
    ),
  );
  const categoryIds = new Map(categories.map((category) => [category.slug, category.id]));

  const brands = await Promise.all(
    BRANDS.map((brand) =>
      prisma.brand.upsert({
        where: { slug: brand.slug },
        update: { name: brand.name },
        create: brand,
        select: { id: true, slug: true },
      }),
    ),
  );
  const brandIds = new Map(brands.map((brand) => [brand.slug, brand.id]));

  const products = new Map<string, SeededProductRecord>();
  const openingStockAt = daysAgo(45, 9);

  for (const definition of PRODUCTS) {
    const categoryId = categoryIds.get(definition.categorySlug);
    const brandId = brandIds.get(definition.brandSlug);
    if (categoryId === undefined || brandId === undefined) {
      throw new Error(`Product ${definition.sku} references an unknown category or brand`);
    }

    const product = await prisma.product.upsert({
      where: { sku: definition.sku },
      update: {
        name: definition.name,
        barcode: definition.barcode,
        categoryId,
        brandId,
        costPrice: definition.costPrice,
        sellingPrice: definition.sellingPrice,
        minimumStock: definition.minimumStock,
      },
      create: {
        sku: definition.sku,
        barcode: definition.barcode,
        name: definition.name,
        categoryId,
        brandId,
        costPrice: definition.costPrice,
        sellingPrice: definition.sellingPrice,
        minimumStock: definition.minimumStock,
      },
      select: { id: true, sku: true, sellingPrice: true, costPrice: true },
    });

    products.set(product.sku, product);

    // Opening stock is written once. Re-running the seed must not inflate it.
    const existingInventory = await prisma.inventory.findUnique({ where: { productId: product.id }, select: { id: true } });
    if (existingInventory !== null) {
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventory.create({ data: { productId: product.id, quantity: definition.openingStock } });

      if (definition.openingStock > 0) {
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: StockMovementType.PURCHASE,
            quantity: definition.openingStock,
            previousQuantity: 0,
            newQuantity: definition.openingStock,
            referenceType: StockReferenceType.PURCHASE,
            note: 'Opening stock',
            createdById,
            createdAt: openingStockAt,
          },
        });
      }
    });
  }

  return { products, categoryCount: CATEGORIES.length, brandCount: BRANDS.length, productCount: PRODUCTS.length };
}
