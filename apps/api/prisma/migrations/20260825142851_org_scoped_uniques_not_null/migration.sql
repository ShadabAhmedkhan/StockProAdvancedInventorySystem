-- DropIndex
DROP INDEX "Brand_name_key";

-- DropIndex
DROP INDEX "Brand_slug_key";

-- DropIndex
DROP INDEX "Category_name_key";

-- DropIndex
DROP INDEX "Category_slug_key";

-- DropIndex
DROP INDEX "Customer_customerCode_key";

-- DropIndex
DROP INDEX "Expense_expenseNumber_key";

-- DropIndex
DROP INDEX "Order_orderNumber_key";

-- DropIndex
DROP INDEX "Payment_paymentNumber_key";

-- DropIndex
DROP INDEX "Product_barcode_key";

-- DropIndex
DROP INDEX "Product_sku_key";

-- DropIndex
DROP INDEX "Repair_repairNumber_key";

-- DropIndex
DROP INDEX "Return_returnNumber_key";

-- DropIndex
DROP INDEX "Setting_key_key";

-- DropIndex
DROP INDEX "Supplier_supplierCode_key";

-- AlterTable
ALTER TABLE "Brand" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "FinancialTransaction" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Inventory" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Repair" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Return" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Setting" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "StockMovement" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Brand_organizationId_name_key" ON "Brand"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_organizationId_slug_key" ON "Brand"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_organizationId_name_key" ON "Category"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_organizationId_slug_key" ON "Category"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_customerCode_key" ON "Customer"("organizationId", "customerCode");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_expenseNumber_key" ON "Expense"("organizationId", "expenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_orderNumber_key" ON "Order"("organizationId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_paymentNumber_key" ON "Payment"("organizationId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_barcode_key" ON "Product"("organizationId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Repair_organizationId_repairNumber_key" ON "Repair"("organizationId", "repairNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Return_organizationId_returnNumber_key" ON "Return"("organizationId", "returnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_organizationId_key_key" ON "Setting"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_supplierCode_key" ON "Supplier"("organizationId", "supplierCode");

