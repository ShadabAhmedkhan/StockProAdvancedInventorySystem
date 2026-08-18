import { Prisma } from '../generated/prisma/client';
import { NOTHING_RETURNED, refundable, refundableInCash, refundFor, totalRefund, type ReturnedSoFar, type SoldLine } from './return-refunds';

function sold(quantity: number, total: string): SoldLine {
  return { quantity, total: new Prisma.Decimal(total) };
}

function already(quantity: number, total: string): ReturnedSoFar {
  return { quantity, total: new Prisma.Decimal(total) };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('return refunds', () => {
  describe('refundable', () => {
    it('reports the whole line when nothing has come back', () => {
      const remaining = refundable(sold(3, '50.00'), NOTHING_RETURNED);

      expect(remaining.quantity).toBe(3);
      expect(remaining.value.toFixed(2)).toBe('50.00');
    });

    it('discounts what earlier returns already took', () => {
      const remaining = refundable(sold(3, '50.00'), already(1, '16.67'));

      expect(remaining.quantity).toBe(2);
      expect(remaining.value.toFixed(2)).toBe('33.33');
    });

    it('is empty once the whole line is back', () => {
      const remaining = refundable(sold(3, '50.00'), already(3, '50.00'));

      expect(remaining.quantity).toBe(0);
      expect(remaining.value.toFixed(2)).toBe('0.00');
    });
  });

  describe('refundFor', () => {
    it('refunds the whole line when all of it comes back at once', () => {
      expect(refundFor(sold(3, '50.00'), NOTHING_RETURNED, 3).toFixed(2)).toBe('50.00');
    });

    it('refunds proportionally for part of a line', () => {
      expect(refundFor(sold(4, '100.00'), NOTHING_RETURNED, 1).toFixed(2)).toBe('25.00');
      expect(refundFor(sold(4, '100.00'), NOTHING_RETURNED, 3).toFixed(2)).toBe('75.00');
    });

    it('rounds a share that has no exact two-decimal form', () => {
      // A third of 50.00 is 16.666..., which has to become 16.67 or 16.66.
      expect(refundFor(sold(3, '50.00'), NOTHING_RETURNED, 1).toFixed(2)).toBe('16.67');
    });

    it('hands back exactly what is left when the last units come home', () => {
      // Two thirds already refunded at 16.67 each leaves 16.66, not 16.67.
      expect(refundFor(sold(3, '50.00'), already(2, '33.34'), 1).toFixed(2)).toBe('16.66');
    });

    it('adds up to the line total however the line is broken up', () => {
      const line = sold(3, '50.00');
      const refunds: Prisma.Decimal[] = [];
      let seen = NOTHING_RETURNED;

      for (let unit = 0; unit < 3; unit += 1) {
        const refund = refundFor(line, seen, 1);
        refunds.push(refund);
        seen = { quantity: seen.quantity + 1, total: seen.total.add(refund) };
      }

      // Three separate single-unit refunds, not 50.01 and not 49.99.
      expect(totalRefund(refunds).toFixed(2)).toBe('50.00');
    });

    it('adds up for an awkward total split seven ways', () => {
      const line = sold(7, '99.99');
      const refunds: Prisma.Decimal[] = [];
      let seen = NOTHING_RETURNED;

      for (let unit = 0; unit < 7; unit += 1) {
        const refund = refundFor(line, seen, 1);
        refunds.push(refund);
        seen = { quantity: seen.quantity + 1, total: seen.total.add(refund) };
      }

      expect(totalRefund(refunds).toFixed(2)).toBe('99.99');
    });

    it('adds up when a line comes back in uneven instalments', () => {
      const line = sold(10, '33.33');
      const first = refundFor(line, NOTHING_RETURNED, 3);
      const second = refundFor(line, { quantity: 3, total: first }, 4);
      const third = refundFor(line, { quantity: 7, total: first.add(second) }, 3);

      expect(totalRefund([first, second, third]).toFixed(2)).toBe('33.33');
    });

    it('respects a line that was discounted at the till', () => {
      // Two units listed at 30.00 with 10.00 off: the refund follows what was
      // charged, not the list price.
      expect(refundFor(sold(2, '50.00'), NOTHING_RETURNED, 1).toFixed(2)).toBe('25.00');
    });

    it('refunds nothing for a line that was given away', () => {
      expect(refundFor(sold(2, '0.00'), NOTHING_RETURNED, 1).toFixed(2)).toBe('0.00');
    });
  });

  describe('totalRefund', () => {
    it('is zero for a return with no lines', () => {
      expect(totalRefund([]).toFixed(2)).toBe('0.00');
    });

    it('is exact where floating point is not', () => {
      expect(totalRefund([decimal('0.10'), decimal('0.20')]).toFixed(2)).toBe('0.30');
    });
  });

  describe('refundableInCash', () => {
    it('hands back the whole credit when the order was paid in full', () => {
      expect(refundableInCash(decimal('50.00'), decimal('100.00'), decimal('0.00')).toFixed(2)).toBe('50.00');
    });

    it('caps the refund at what the customer actually paid', () => {
      // Half-paid order, everything returned: only the half that arrived can
      // go back out.
      expect(refundableInCash(decimal('100.00'), decimal('40.00'), decimal('0.00')).toFixed(2)).toBe('40.00');
    });

    it('counts refunds already made against the same order', () => {
      expect(refundableInCash(decimal('50.00'), decimal('100.00'), decimal('80.00')).toFixed(2)).toBe('20.00');
    });

    it('refunds nothing once everything collected has gone back', () => {
      expect(refundableInCash(decimal('25.00'), decimal('100.00'), decimal('100.00')).toFixed(2)).toBe('0.00');
    });

    it('refunds nothing on an order that was never paid', () => {
      expect(refundableInCash(decimal('50.00'), decimal('0.00'), decimal('0.00')).toFixed(2)).toBe('0.00');
    });

    it('never returns a negative amount', () => {
      expect(refundableInCash(decimal('10.00'), decimal('20.00'), decimal('30.00')).toFixed(2)).toBe('0.00');
    });
  });
});
