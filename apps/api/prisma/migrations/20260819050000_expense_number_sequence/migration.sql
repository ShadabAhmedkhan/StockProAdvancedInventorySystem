-- Expense numbers, drawn the same way as order, payment, repair and return
-- numbers: see 20260817061500_document_number_sequences for why these are
-- sequences rather than a MAX() read, and why gaps are the accepted trade-off.
CREATE SEQUENCE "expense_number_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;
