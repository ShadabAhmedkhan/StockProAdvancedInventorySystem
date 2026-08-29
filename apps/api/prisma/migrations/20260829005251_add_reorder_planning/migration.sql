-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "preferredSupplierId" UUID,
ADD COLUMN     "reorderPoint" INTEGER,
ADD COLUMN     "safetyStock" INTEGER,
ADD COLUMN     "supplierLeadTimeDays" INTEGER,
ADD COLUMN     "targetStock" INTEGER;

-- CreateIndex
CREATE INDEX "Product_preferredSupplierId_idx" ON "Product"("preferredSupplierId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
