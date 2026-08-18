import { RepairStatus } from '../generated/prisma/enums';

/**
 * The repair workflow, as a map of what may follow what.
 *
 * ```text
 *   RECEIVED -> DIAGNOSING -> WAITING_APPROVAL -> APPROVED -> IN_PROGRESS -> COMPLETED -> DELIVERED
 *                    |                                |          |    ^
 *                    +-- straight to APPROVED when    |          v    |
 *                        the fault is obvious         +----> WAITING_PARTS
 *
 *   every unfinished status -> CANCELLED
 * ```
 *
 * Stated as data rather than as a chain of `if`s, so the whole workflow can be
 * read in one place and an illegal move is refused by the same rule wherever
 * it is attempted.
 *
 * Two statuses are terminal. A DELIVERED repair is finished - the device has
 * gone back to its owner. A CANCELLED one is abandoned. Neither may move
 * again: the alternative is a device that has left the shop being quietly put
 * back into progress.
 */
export const REPAIR_TRANSITIONS: Readonly<Record<RepairStatus, readonly RepairStatus[]>> = {
  [RepairStatus.RECEIVED]: [RepairStatus.DIAGNOSING, RepairStatus.CANCELLED],
  // A quote may be needed, or the fault may be obvious enough to start on.
  [RepairStatus.DIAGNOSING]: [RepairStatus.WAITING_APPROVAL, RepairStatus.APPROVED, RepairStatus.CANCELLED],
  // The customer either agrees to the quote or declines it.
  [RepairStatus.WAITING_APPROVAL]: [RepairStatus.APPROVED, RepairStatus.CANCELLED],
  [RepairStatus.APPROVED]: [RepairStatus.IN_PROGRESS, RepairStatus.WAITING_PARTS, RepairStatus.CANCELLED],
  [RepairStatus.IN_PROGRESS]: [RepairStatus.WAITING_PARTS, RepairStatus.COMPLETED, RepairStatus.CANCELLED],
  [RepairStatus.WAITING_PARTS]: [RepairStatus.IN_PROGRESS, RepairStatus.CANCELLED],
  // The work is done; all that is left is handing the device back.
  [RepairStatus.COMPLETED]: [RepairStatus.DELIVERED],
  [RepairStatus.DELIVERED]: [],
  [RepairStatus.CANCELLED]: [],
};

/**
 * The statuses in which a repair is still being worked on, and so can still
 * have its details and its parts changed.
 *
 * COMPLETED is absent even though it can still move to DELIVERED: the work is
 * finished and its parts have already been taken out of stock, so changing the
 * list of parts afterwards would mean the ledger and the device disagree.
 */
export const OPEN_REPAIR_STATUSES: readonly RepairStatus[] = [
  RepairStatus.RECEIVED,
  RepairStatus.DIAGNOSING,
  RepairStatus.WAITING_APPROVAL,
  RepairStatus.APPROVED,
  RepairStatus.IN_PROGRESS,
  RepairStatus.WAITING_PARTS,
];

/** Statuses in which the amount is settled, so money may be taken. */
export const PAYABLE_REPAIR_STATUSES: readonly RepairStatus[] = [RepairStatus.COMPLETED, RepairStatus.DELIVERED];

export function canTransition(from: RepairStatus, to: RepairStatus): boolean {
  return REPAIR_TRANSITIONS[from].includes(to);
}

/** What a caller may do next, used to explain a refusal. */
export function nextStatuses(from: RepairStatus): readonly RepairStatus[] {
  return REPAIR_TRANSITIONS[from];
}
