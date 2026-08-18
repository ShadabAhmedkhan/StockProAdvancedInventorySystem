-- Document numbers.
--
-- Order and payment numbers are human-facing identifiers printed on receipts,
-- so they cannot be uuids and cannot be derived from a MAX() read: two tills
-- ringing up a sale at the same moment would read the same maximum and pick
-- the same number. A sequence hands out each value exactly once without any
-- lock held for the duration of the surrounding transaction.
--
-- Sequences are deliberately non-transactional, so a rolled-back sale consumes
-- its number and leaves a gap. That is the accepted trade-off: a gapless
-- counter would have to serialise every sale behind one row lock, and the
-- numbers stay unique and monotonic either way.
--
-- These objects are not expressible in the Prisma schema; they are read with
-- `nextval` from application code.
CREATE SEQUENCE "order_number_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;
CREATE SEQUENCE "payment_number_seq" AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;
