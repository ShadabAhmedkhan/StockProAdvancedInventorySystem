import { Prisma } from '../generated/prisma/client';
import { PaymentStatus } from '../generated/prisma/enums';
import { lineGross, lineTotal, orderTotals, paymentStatusFor, ZERO, type LineAmounts } from './order-totals';

function line(unitPrice: string, quantity: number, discount = '0'): LineAmounts {
  return { quantity, unitPrice: new Prisma.Decimal(unitPrice), discount: new Prisma.Decimal(discount) };
}

describe('order totals', () => {
  describe('lineTotal', () => {
    it('multiplies the price by the quantity', () => {
      expect(lineTotal(line('19.99', 3)).toFixed(2)).toBe('59.97');
    });

    it('takes the line discount off the goods', () => {
      expect(lineTotal(line('19.99', 3, '9.97')).toFixed(2)).toBe('50.00');
    });

    it('is exact where floating point is not', () => {
      // 0.07 * 3 is 0.21000000000000002 in binary floating point.
      expect(lineTotal(line('0.07', 3)).toFixed(2)).toBe('0.21');
      expect(
        lineTotal(line('0.10', 1, '0'))
          .add(new Prisma.Decimal('0.20'))
          .toFixed(2),
      ).toBe('0.30');
    });

    it('handles a free line without turning it into a negative', () => {
      expect(lineTotal(line('25.00', 2, '50.00')).toFixed(2)).toBe('0.00');
    });

    it('reports the goods before the discount', () => {
      expect(lineGross(line('19.99', 3, '9.97')).toFixed(2)).toBe('59.97');
    });
  });

  describe('orderTotals', () => {
    it('sums the lines into the subtotal', () => {
      const totals = orderTotals([line('19.99', 3), line('5.50', 2)], ZERO, ZERO);

      expect(totals.subtotal.toFixed(2)).toBe('70.97');
      expect(totals.total.toFixed(2)).toBe('70.97');
    });

    it('sums the lines net of their own discounts', () => {
      const totals = orderTotals([line('19.99', 3, '9.97'), line('5.50', 2, '1.00')], ZERO, ZERO);

      expect(totals.subtotal.toFixed(2)).toBe('60.00');
    });

    it('takes the order discount off and adds the tax on', () => {
      const totals = orderTotals([line('100.00', 1)], new Prisma.Decimal('10.00'), new Prisma.Decimal('4.50'));

      expect(totals.subtotal.toFixed(2)).toBe('100.00');
      expect(totals.total.toFixed(2)).toBe('94.50');
    });

    it('stays exact across many small lines', () => {
      // Ten cents added a penny at a time: 0.1 in binary drifts, 0.1 here does not.
      const totals = orderTotals(
        Array.from({ length: 10 }, () => line('0.01', 1)),
        ZERO,
        ZERO,
      );

      expect(totals.subtotal.toFixed(2)).toBe('0.10');
    });

    it('is zero for an order with no lines', () => {
      const totals = orderTotals([], ZERO, ZERO);

      expect(totals.subtotal.toFixed(2)).toBe('0.00');
      expect(totals.total.toFixed(2)).toBe('0.00');
    });

    it('echoes the discount and tax it was given, so the caller stores what it charged', () => {
      const totals = orderTotals([line('10.00', 1)], new Prisma.Decimal('2.00'), new Prisma.Decimal('1.00'));

      expect(totals.discount.toFixed(2)).toBe('2.00');
      expect(totals.tax.toFixed(2)).toBe('1.00');
    });
  });

  describe('paymentStatusFor', () => {
    it.each([
      ['0.00', '50.00', PaymentStatus.UNPAID],
      ['0.01', '50.00', PaymentStatus.PARTIAL],
      ['49.99', '50.00', PaymentStatus.PARTIAL],
      ['50.00', '50.00', PaymentStatus.PAID],
    ])('is %s of %s -> %s', (paid, total, expected) => {
      expect(paymentStatusFor(new Prisma.Decimal(paid), new Prisma.Decimal(total))).toBe(expected);
    });

    it('treats a free order with nothing paid as unpaid rather than paid', () => {
      // Nothing is owed, but nothing was taken either; a receipt should not
      // claim a payment that never happened.
      expect(paymentStatusFor(ZERO, ZERO)).toBe(PaymentStatus.UNPAID);
    });

    it('never reports REFUNDED, which only a return can set', () => {
      expect(paymentStatusFor(new Prisma.Decimal('50.00'), new Prisma.Decimal('50.00'))).not.toBe(PaymentStatus.REFUNDED);
    });
  });
});
