import type { Prisma } from '../../generated/prisma/client';
import type { TenantTransactionClient } from '../../prisma/tenant-prisma.provider';

/**
 * The kinds of document that carry a human-facing number, and the sequence
 * each one draws from.
 *
 * Numbers are printed on receipts and quoted over the phone, so they cannot be
 * uuids, and they cannot come from `MAX(number) + 1`: two tills ringing up a
 * sale in the same instant would read the same maximum and choose the same
 * number. A PostgreSQL sequence hands out every value exactly once with no
 * lock held for the life of the surrounding transaction.
 *
 * Sequences are non-transactional by design, so a rolled-back document
 * consumes its number and leaves a gap. That is the accepted trade-off: a
 * gapless counter would serialise every sale behind a single row lock, and the
 * numbers remain unique and monotonic either way.
 */
export const DOCUMENT_SEQUENCES = {
  ORDER: { prefix: 'ORD', sequence: 'order_number_seq' },
  PAYMENT: { prefix: 'PAY', sequence: 'payment_number_seq' },
  REPAIR: { prefix: 'REP', sequence: 'repair_number_seq' },
  RETURN: { prefix: 'RET', sequence: 'return_number_seq' },
  EXPENSE: { prefix: 'EXP', sequence: 'expense_number_seq' },
} as const;

export type DocumentKind = keyof typeof DOCUMENT_SEQUENCES;

/** Digits in the numeric part. Eight leaves room for a century of trading. */
const NUMBER_WIDTH = 8;

/**
 * Draws the next document number for `kind`, e.g. `ORD-00000042`.
 *
 * @param tx The client of the surrounding transaction, so the call travels on
 * the same connection as the insert that will use the number.
 */
export async function nextDocumentNumber(tx: Prisma.TransactionClient | TenantTransactionClient, kind: DocumentKind): Promise<string> {
  const { prefix, sequence } = DOCUMENT_SEQUENCES[kind];

  // The sequence name is a bound parameter cast to `regclass`, not spliced
  // into the statement, and it comes from the table above rather than from a
  // caller. An unknown name fails as a missing relation, never as SQL.
  const [row] = await tx.$queryRaw<{ value: string }[]>`SELECT nextval(${sequence}::regclass)::text AS "value"`;

  if (row === undefined) {
    throw new Error(`Sequence ${sequence} returned no value`);
  }

  return `${prefix}-${row.value.padStart(NUMBER_WIDTH, '0')}`;
}
