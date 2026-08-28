-- CreateEnum
CREATE TYPE "ProductTrackingType" AS ENUM ('NONE', 'SERIAL', 'IMEI');

-- CreateEnum
CREATE TYPE "ProductCondition" AS ENUM ('NEW', 'USED', 'REFURBISHED');

-- CreateEnum
CREATE TYPE "ProductUnitStatus" AS ENUM ('IN_STOCK', 'SOLD', 'RETURNED', 'DAMAGED');

-- AlterEnum
ALTER TYPE "AuditEntity" ADD VALUE 'PRODUCT_UNIT';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "color" VARCHAR(60),
ADD COLUMN     "condition" "ProductCondition" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "model" VARCHAR(120),
ADD COLUMN     "storage" VARCHAR(60),
ADD COLUMN     "trackingType" "ProductTrackingType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "variant" VARCHAR(120),
ADD COLUMN     "warrantyMonths" INTEGER;

-- CreateTable
CREATE TABLE "ProductUnit" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "serialNumber" VARCHAR(64) NOT NULL,
    "status" "ProductUnitStatus" NOT NULL DEFAULT 'IN_STOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductUnit_productId_idx" ON "ProductUnit"("productId");

-- CreateIndex
CREATE INDEX "ProductUnit_status_idx" ON "ProductUnit"("status");

-- CreateIndex
CREATE INDEX "ProductUnit_locationId_idx" ON "ProductUnit"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_organizationId_serialNumber_key" ON "ProductUnit"("organizationId", "serialNumber");

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
