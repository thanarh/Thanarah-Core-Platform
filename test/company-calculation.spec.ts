import { describe, expect, it } from 'vitest';
import {
  journalTotals,
  periodBounds,
  rateMinor,
  totalMinor,
} from '../src/internal-operations/operations.calculation';
import { schemas } from '../src/internal-operations/operations.model';
import { randomUUID } from 'node:crypto';

describe('Company money contracts', () => {
  it('rounds positive half-up basis points exactly without floating point multiplication', () => {
    expect(rateMinor(10005, 1000)).toBe(1001);
    expect(rateMinor(1_000_000_000_000, 9999)).toBe(999_900_000_000);
    expect(rateMinor(1, 5000)).toBe(1);
    expect(rateMinor(1, 4999)).toBe(0);
    expect(() => rateMinor(-1, 100)).toThrow();
    expect(() => rateMinor(100, 10001)).toThrow();
  });
  it('rejects invalid sides and unbalanced entries', () => {
    const accountId = randomUUID();
    expect(() => journalTotals([{ accountId, debitMinor: 2, creditMinor: 2 }])).toThrow();
    expect(() => journalTotals([{ accountId, debitMinor: 0, creditMinor: 0 }])).toThrow();
    expect(() =>
      journalTotals([
        { accountId, debitMinor: 10, creditMinor: 0 },
        { accountId, debitMinor: 0, creditMinor: 9 },
      ]),
    ).toThrow();
    expect(
      journalTotals([
        { accountId, debitMinor: 11, creditMinor: 0 },
        { accountId, debitMinor: 0, creditMinor: 11 },
      ]),
    ).toEqual({ debitMinor: 11, creditMinor: 11 });
  });
  it('detects unsafe totals instead of rounding silently', () => {
    expect(totalMinor([Number.MAX_SAFE_INTEGER, -1])).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(() => totalMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow();
  });
  it('validates exact money and calendar boundaries', () => {
    expect(periodBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(() => periodBounds('2026-13')).toThrow();
    expect(
      schemas.accounts.safeParse({
        code: 'A',
        name: 'Cash',
        type: 'ASSET',
        currency: 'USD',
        status: 'ACTIVE',
      }).success,
    ).toBe(false);
    expect(
      schemas.contracts.safeParse({
        employeeId: randomUUID(),
        title: 'Synthetic',
        startDate: '2026-11-01',
        endDate: null,
        monthlyMinor: 100.1,
        currency: 'SAR',
        status: 'DRAFT',
      }).success,
    ).toBe(false);
  });
});
