import { Prisma } from '../generated/prisma/client';
import { lineGross, lineTotal, purchaseOrderTotals, ZERO, type LineAmounts } from './purchase-order-totals';

function line(unitCost: string, quantity: number, discount = '0'): LineAmounts {
  return { quantity, unitCost: new Prisma.Decimal(unitCost), discount: new Prisma.Decimal(discount) };
}

describe('purchase order totals', () => {
  describe('lineTotal', () => {
    it('multiplies the cost by the quantity', () => {
      expect(lineTotal(line('10.00', 5)).toFixed(2)).toBe('50.00');
    });

    it('takes the line discount off the cost', () => {
      expect(lineTotal(line('10.00', 5, '5.00')).toFixed(2)).toBe('45.00');
    });

    it('is exact where floating point is not', () => {
      expect(lineTotal(line('0.07', 3)).toFixed(2)).toBe('0.21');
    });

    it('reports the cost before the discount', () => {
      expect(lineGross(line('10.00', 5, '5.00')).toFixed(2)).toBe('50.00');
    });
  });

  describe('purchaseOrderTotals', () => {
    it('sums the lines into the subtotal', () => {
      const totals = purchaseOrderTotals([line('10.00', 5), line('2.50', 4)], ZERO, ZERO, ZERO);

      expect(totals.subtotal.toFixed(2)).toBe('60.00');
      expect(totals.total.toFixed(2)).toBe('60.00');
    });

    it('takes the order discount off and adds tax and shipping on', () => {
      const totals = purchaseOrderTotals(
        [line('100.00', 1)],
        new Prisma.Decimal('10.00'),
        new Prisma.Decimal('4.50'),
        new Prisma.Decimal('15.00'),
      );

      expect(totals.subtotal.toFixed(2)).toBe('100.00');
      expect(totals.total.toFixed(2)).toBe('109.50');
    });

    it('folds shipping in even with no lines', () => {
      const totals = purchaseOrderTotals([], ZERO, ZERO, new Prisma.Decimal('20.00'));

      expect(totals.subtotal.toFixed(2)).toBe('0.00');
      expect(totals.total.toFixed(2)).toBe('20.00');
    });

    it('is zero for an order with no lines and no extras', () => {
      const totals = purchaseOrderTotals([], ZERO, ZERO, ZERO);

      expect(totals.subtotal.toFixed(2)).toBe('0.00');
      expect(totals.total.toFixed(2)).toBe('0.00');
    });

    it('echoes back the discount, tax and shipping it was given', () => {
      const totals = purchaseOrderTotals(
        [line('10.00', 1)],
        new Prisma.Decimal('2.00'),
        new Prisma.Decimal('1.00'),
        new Prisma.Decimal('3.00'),
      );

      expect(totals.discount.toFixed(2)).toBe('2.00');
      expect(totals.tax.toFixed(2)).toBe('1.00');
      expect(totals.shipping.toFixed(2)).toBe('3.00');
    });
  });
});
