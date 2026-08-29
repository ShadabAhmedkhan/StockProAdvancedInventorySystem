-- Stock count numbers, drawn the same way as order, payment, repair, return,
-- expense, purchase order and stock transfer numbers: see
-- 20260817061500_document_number_sequences for why these are sequences
-- rather than a MAX() read, and why gaps are the accepted trade-off.
CREATE SEQUENCE "stock_count_number_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

-- Same invariant style as PurchaseOrderItem: the last line of defence behind
-- the conditional UPDATE in the service layer.
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_expectedQuantity_non_negative" CHECK ("expectedQuantity" >= 0);
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_countedQuantity_non_negative" CHECK ("countedQuantity" IS NULL OR "countedQuantity" >= 0);
