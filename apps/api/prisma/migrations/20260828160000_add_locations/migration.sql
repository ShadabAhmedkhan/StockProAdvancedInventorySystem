-- Phase 32: Locations / Branches.
--
-- Order matters here in a way the declarative schema diff cannot express on
-- its own: the new `locationId` columns must exist and be backfilled BEFORE
-- they can be made NOT NULL, and Location rows (one default per existing
-- Organization) must exist before anything can be backfilled to them.

-- 1. New enum and the Location / UserLocationAccess tables.
CREATE TYPE "LocationType" AS ENUM ('STORE', 'WAREHOUSE', 'SERVICE_CENTER');

CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'STORE',
    "address" VARCHAR(500),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserLocationAccess" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLocationAccess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Location_organizationId_idx" ON "Location"("organizationId");
CREATE INDEX "Location_deletedAt_idx" ON "Location"("deletedAt");
CREATE INDEX "UserLocationAccess_locationId_idx" ON "UserLocationAccess"("locationId");
CREATE UNIQUE INDEX "UserLocationAccess_userId_locationId_key" ON "UserLocationAccess"("userId", "locationId");

ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLocationAccess" ADD CONSTRAINT "UserLocationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserLocationAccess" ADD CONSTRAINT "UserLocationAccess_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one non-deleted Location per organization may be the default.
-- Prisma's schema DSL cannot express a partial unique index, so it is raw SQL.
CREATE UNIQUE INDEX "Location_one_default_per_org" ON "Location" ("organizationId") WHERE "isDefault" = true AND "deletedAt" IS NULL;

-- 2. One default Location per existing Organization.
INSERT INTO "Location" ("id", "organizationId", "name", "type", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", 'Main Location', 'STORE', true, true, NOW(), NOW()
FROM "Organization";

-- 3. Add the new columns nullable, so existing rows can be backfilled before
-- the NOT NULL constraint is applied.
ALTER TABLE "Inventory" ADD COLUMN "locationId" UUID;
ALTER TABLE "StockMovement" ADD COLUMN "locationId" UUID;

-- 4. Point every existing Inventory / StockMovement row at its organization's
-- new default Location.
UPDATE "Inventory" i
SET "locationId" = l."id"
FROM "Location" l
WHERE l."organizationId" = i."organizationId" AND l."isDefault" = true;

UPDATE "StockMovement" sm
SET "locationId" = l."id"
FROM "Location" l
WHERE l."organizationId" = sm."organizationId" AND l."isDefault" = true;

-- 5. Now that every row has a value, tighten the columns to NOT NULL.
ALTER TABLE "Inventory" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "locationId" SET NOT NULL;

-- 6. Inventory moves from one row per product to one row per (product, location).
DROP INDEX "Inventory_productId_key";
CREATE UNIQUE INDEX "Inventory_productId_locationId_key" ON "Inventory"("productId", "locationId");

CREATE INDEX "Inventory_locationId_idx" ON "Inventory"("locationId");
CREATE INDEX "StockMovement_locationId_idx" ON "StockMovement"("locationId");

ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
