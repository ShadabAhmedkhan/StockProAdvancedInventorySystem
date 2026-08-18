import { ReturnStatus } from '../generated/prisma/enums';

/**
 * The return workflow.
 *
 * ```text
 *   PENDING --approve--> APPROVED --complete--> COMPLETED
 *      |
 *      +---reject--> REJECTED
 * ```
 *
 * A return is raised at the counter, then somebody who can authorise money
 * decides whether to take the goods back, and only then does stock come in and
 * the refund go out. Approval is a separate step on purpose: it is the point
 * at which the shop commits, and separating it is what lets the two halves sit
 * with different people.
 *
 * REJECTED and COMPLETED are both final. A rejected return releases its claim
 * on the goods, so the same units can be put on another return; a completed
 * one has already moved stock and money and cannot be replayed.
 */
export const RETURN_TRANSITIONS: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  [ReturnStatus.PENDING]: [ReturnStatus.APPROVED, ReturnStatus.REJECTED],
  [ReturnStatus.APPROVED]: [ReturnStatus.COMPLETED],
  [ReturnStatus.REJECTED]: [],
  [ReturnStatus.COMPLETED]: [],
};

/**
 * The statuses whose lines still count against what an order line has left to
 * return.
 *
 * A rejected return is absent: the shop declined it, so those units were never
 * taken back and are open to be claimed again.
 */
export const CLAIMING_RETURN_STATUSES: readonly ReturnStatus[] = [ReturnStatus.PENDING, ReturnStatus.APPROVED, ReturnStatus.COMPLETED];

export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: ReturnStatus): readonly ReturnStatus[] {
  return RETURN_TRANSITIONS[from];
}
