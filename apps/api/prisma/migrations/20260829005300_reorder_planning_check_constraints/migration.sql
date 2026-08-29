-- Reorder planning fields are all optional, but if set they must be
-- non-negative - the last line of defence behind DTO validation.
ALTER TABLE "Product" ADD CONSTRAINT "Product_reorderPoint_non_negative" CHECK ("reorderPoint" IS NULL OR "reorderPoint" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_targetStock_non_negative" CHECK ("targetStock" IS NULL OR "targetStock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_safetyStock_non_negative" CHECK ("safetyStock" IS NULL OR "safetyStock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierLeadTimeDays_non_negative" CHECK ("supplierLeadTimeDays" IS NULL OR "supplierLeadTimeDays" >= 0);
