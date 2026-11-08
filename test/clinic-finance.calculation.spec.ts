import { describe, expect, it } from 'vitest';
import {
  calculateClinicInvoiceTotals,
  currencyFractionDigits,
  formatClinicInvoiceNumber,
  isSupportedCurrencyCode,
} from '../src/tenant/clinic-finance.calculation';

describe('clinic invoice calculations', () => {
  it('accepts only supported ISO currency codes and uses currency precision', () => {
    expect(isSupportedCurrencyCode('SAR')).toBe(true);
    expect(isSupportedCurrencyCode('ZZZ')).toBe(false);
    expect(currencyFractionDigits('SAR')).toBe(2);
    expect(currencyFractionDigits('JPY')).toBe(0);
    expect(currencyFractionDigits('KWD')).toBe(3);
  });

  it('uses integer arithmetic for quantity, line rounding, and no-tax totals', () => {
    const totals = calculateClinicInvoiceTotals(
      [
        { id: 'line-a', description: 'A', quantityMilli: 1_500, unitPriceMinor: 100 },
        { id: 'line-b', description: 'B', quantityMilli: 1_000, unitPriceMinor: 25 },
      ],
      { id: 'tax-none', name: 'No tax', type: 'NO_TAX' },
      'HALF_UP',
    );

    expect(totals).toEqual({
      subtotalMinor: 175,
      taxMinor: 0,
      totalMinor: 175,
      lineTotalsMinor: [150, 25],
    });
  });

  it('supports explicit per-line and subtotal tax rounding without floating point', () => {
    const lines = [
      { id: 'line-a', description: 'A', quantityMilli: 1_000, unitPriceMinor: 1 },
      { id: 'line-b', description: 'B', quantityMilli: 1_000, unitPriceMinor: 1 },
    ];
    const perLine = calculateClinicInvoiceTotals(
      lines,
      {
        id: 'tax-per-line',
        name: 'Configured rate',
        type: 'RATE',
        rateBasisPoints: 5_000,
        calculation: 'PER_LINE',
        rounding: 'HALF_UP',
      },
      'DOWN',
    );
    const subtotal = calculateClinicInvoiceTotals(
      lines,
      {
        id: 'tax-subtotal',
        name: 'Configured rate',
        type: 'RATE',
        rateBasisPoints: 5_000,
        calculation: 'SUBTOTAL',
        rounding: 'HALF_UP',
      },
      'DOWN',
    );

    expect(perLine.taxMinor).toBe(2);
    expect(subtotal.taxMinor).toBe(1);
  });

  it('applies explicit rounding modes and rejects unsafe numbers', () => {
    const half = [{ id: 'half', description: 'Half', quantityMilli: 500, unitPriceMinor: 1 }];
    const tax = { id: 'none', name: 'No tax', type: 'NO_TAX' as const };
    expect(calculateClinicInvoiceTotals(half, tax, 'HALF_UP').totalMinor).toBe(1);
    expect(calculateClinicInvoiceTotals(half, tax, 'DOWN').totalMinor).toBe(0);
    expect(calculateClinicInvoiceTotals(half, tax, 'UP').totalMinor).toBe(1);
    expect(() =>
      calculateClinicInvoiceTotals(
        [
          {
            id: 'large',
            description: 'Large',
            quantityMilli: 1_000_000,
            unitPriceMinor: Number.MAX_SAFE_INTEGER,
          },
        ],
        tax,
        'DOWN',
      ),
    ).toThrow(RangeError);
    expect(() => formatClinicInvoiceNumber('INV-', 0, 3)).toThrow(RangeError);
    expect(formatClinicInvoiceNumber('INV-', 7, 3)).toBe('INV-007');
  });
});
