-- Same invariant style as Inventory's reserved-within-quantity: the last line
-- of defence behind the conditional UPDATE in the service layer.
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_receivedQuantity_non_negative" CHECK ("receivedQuantity" >= 0);
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_receivedQuantity_within_quantity" CHECK ("receivedQuantity" <= "quantity");
ALTER TABLE "GoodsReceiptItem" ADD CONSTRAINT "GoodsReceiptItem_quantityReceived_positive" CHECK ("quantityReceived" > 0);
