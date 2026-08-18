import { ReturnStatus } from '../generated/prisma/enums';
import { canTransition, CLAIMING_RETURN_STATUSES, nextStatuses, RETURN_TRANSITIONS } from './return-status';

const EVERY_STATUS = Object.values(ReturnStatus);

describe('return status machine', () => {
  it('covers every status', () => {
    expect(Object.keys(RETURN_TRANSITIONS).sort()).toEqual([...EVERY_STATUS].sort());
  });

  it('walks a return from the counter to the till', () => {
    expect(canTransition(ReturnStatus.PENDING, ReturnStatus.APPROVED)).toBe(true);
    expect(canTransition(ReturnStatus.APPROVED, ReturnStatus.COMPLETED)).toBe(true);
  });

  it('lets a pending return be declined', () => {
    expect(canTransition(ReturnStatus.PENDING, ReturnStatus.REJECTED)).toBe(true);
  });

  it('refuses to refund without approval first', () => {
    // Approval is the point at which the shop commits to taking the goods
    // back, and it is deliberately somebody else's decision.
    expect(canTransition(ReturnStatus.PENDING, ReturnStatus.COMPLETED)).toBe(false);
  });

  it('refuses to decline a return the shop already agreed to', () => {
    expect(canTransition(ReturnStatus.APPROVED, ReturnStatus.REJECTED)).toBe(false);
  });

  it.each([ReturnStatus.REJECTED, ReturnStatus.COMPLETED])('makes %s final', (status) => {
    expect(nextStatuses(status)).toEqual([]);
    expect(EVERY_STATUS.some((target) => canTransition(status, target))).toBe(false);
  });

  it('never lets a return sit still', () => {
    expect(EVERY_STATUS.some((status) => canTransition(status, status))).toBe(false);
  });

  it('counts every status except a rejection against what a line has left', () => {
    // A declined return never took the goods, so its units are free again.
    expect(CLAIMING_RETURN_STATUSES).not.toContain(ReturnStatus.REJECTED);
    expect([...CLAIMING_RETURN_STATUSES].sort()).toEqual([ReturnStatus.PENDING, ReturnStatus.APPROVED, ReturnStatus.COMPLETED].sort());
  });

  it('keeps every status reachable from a new return', () => {
    const reachable = new Set<ReturnStatus>([ReturnStatus.PENDING]);
    const pending: ReturnStatus[] = [ReturnStatus.PENDING];

    for (const from of pending) {
      for (const to of nextStatuses(from)) {
        if (!reachable.has(to)) {
          reachable.add(to);
          pending.push(to);
        }
      }
    }

    expect([...reachable].sort()).toEqual([...EVERY_STATUS].sort());
  });
});
