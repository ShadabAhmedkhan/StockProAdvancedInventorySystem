-- Return numbers, drawn the same way as order, payment and repair numbers: see
-- 20260817061500_document_number_sequences for why these are sequences rather
-- than a MAX() read, and why gaps are the accepted trade-off.
CREATE SEQUENCE "return_number_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;
