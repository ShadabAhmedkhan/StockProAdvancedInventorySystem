import { RepairStatus } from '../generated/prisma/enums';
import { canTransition, nextStatuses, OPEN_REPAIR_STATUSES, PAYABLE_REPAIR_STATUSES, REPAIR_TRANSITIONS } from './repair-status';

const EVERY_STATUS = Object.values(RepairStatus);

describe('repair status machine', () => {
  it('covers every status, so no repair can reach a state the map has not heard of', () => {
    expect(Object.keys(REPAIR_TRANSITIONS).sort()).toEqual([...EVERY_STATUS].sort());
  });

  it('walks the ordinary job from intake to hand-over', () => {
    const journey = [
      RepairStatus.RECEIVED,
      RepairStatus.DIAGNOSING,
      RepairStatus.WAITING_APPROVAL,
      RepairStatus.APPROVED,
      RepairStatus.IN_PROGRESS,
      RepairStatus.COMPLETED,
      RepairStatus.DELIVERED,
    ];

    for (const [index, from] of journey.slice(0, -1).entries()) {
      expect(canTransition(from, journey[index + 1] as RepairStatus)).toBe(true);
    }
  });

  it('lets an obvious fault skip the quote', () => {
    expect(canTransition(RepairStatus.DIAGNOSING, RepairStatus.APPROVED)).toBe(true);
  });

  it('lets a job wait for parts and come back', () => {
    expect(canTransition(RepairStatus.IN_PROGRESS, RepairStatus.WAITING_PARTS)).toBe(true);
    expect(canTransition(RepairStatus.WAITING_PARTS, RepairStatus.IN_PROGRESS)).toBe(true);
  });

  it.each(OPEN_REPAIR_STATUSES)('lets a %s repair be cancelled', (status) => {
    expect(canTransition(status, RepairStatus.CANCELLED)).toBe(true);
  });

  it.each([RepairStatus.DELIVERED, RepairStatus.CANCELLED])('makes %s final', (status) => {
    expect(nextStatuses(status)).toEqual([]);
    expect(EVERY_STATUS.some((target) => canTransition(status, target))).toBe(false);
  });

  it('refuses to cancel work that is already done', () => {
    // Finished work is undone by handing the device back, not by pretending
    // the repair never happened; the parts have already left stock.
    expect(canTransition(RepairStatus.COMPLETED, RepairStatus.CANCELLED)).toBe(false);
  });

  it('only lets a completed repair be delivered', () => {
    expect(nextStatuses(RepairStatus.COMPLETED)).toEqual([RepairStatus.DELIVERED]);
  });

  it('refuses to run before it can walk', () => {
    expect(canTransition(RepairStatus.RECEIVED, RepairStatus.COMPLETED)).toBe(false);
    expect(canTransition(RepairStatus.RECEIVED, RepairStatus.IN_PROGRESS)).toBe(false);
    expect(canTransition(RepairStatus.APPROVED, RepairStatus.DELIVERED)).toBe(false);
  });

  it('never lets a repair sit still', () => {
    expect(EVERY_STATUS.some((status) => canTransition(status, status))).toBe(false);
  });

  it('treats exactly the unfinished statuses as open for changes', () => {
    expect([...OPEN_REPAIR_STATUSES].sort()).toEqual(
      [
        RepairStatus.RECEIVED,
        RepairStatus.DIAGNOSING,
        RepairStatus.WAITING_APPROVAL,
        RepairStatus.APPROVED,
        RepairStatus.IN_PROGRESS,
        RepairStatus.WAITING_PARTS,
      ].sort(),
    );
  });

  it('closes a completed repair to further changes, though it can still be delivered', () => {
    // Its parts have already left stock; changing them now would put the
    // ledger and the device out of step.
    expect(OPEN_REPAIR_STATUSES).not.toContain(RepairStatus.COMPLETED);
    expect(nextStatuses(RepairStatus.COMPLETED)).toContain(RepairStatus.DELIVERED);
  });

  it('takes money only once the work is done', () => {
    expect(PAYABLE_REPAIR_STATUSES).toEqual([RepairStatus.COMPLETED, RepairStatus.DELIVERED]);
    for (const status of OPEN_REPAIR_STATUSES) {
      expect(PAYABLE_REPAIR_STATUSES).not.toContain(status);
    }
  });

  it('keeps every open status reachable from intake', () => {
    // A status nothing can reach is a status that will never be used.
    // Breadth-first from intake; the queue grows as new statuses are found.
    const reachable = new Set<RepairStatus>([RepairStatus.RECEIVED]);
    const pending: RepairStatus[] = [RepairStatus.RECEIVED];

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
