import type { z } from 'zod';
import type { lineSchema } from './operations.model';

export function totalMinor(values: readonly number[]): number {
  const total = values.reduce((sum, v) => sum + BigInt(v), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('FINANCIAL_TOTAL_OVERFLOW');
  }
  return Number(total);
}
export function rateMinor(basis: number, bps: number): number {
  if (
    !Number.isSafeInteger(basis) ||
    basis < 0 ||
    !Number.isInteger(bps) ||
    bps < 0 ||
    bps > 10000
  ) {
    throw new Error('FINANCIAL_INPUT_INVALID');
  }
  return Number((BigInt(basis) * BigInt(bps) + 5000n) / 10000n);
}
export function journalTotals(lines: z.infer<typeof lineSchema>[]): {
  debitMinor: number;
  creditMinor: number;
} {
  if (lines.some((l) => (l.debitMinor === 0) === (l.creditMinor === 0)))
    throw new Error('JOURNAL_LINE_INVALID');
  const debitMinor = totalMinor(lines.map((l) => l.debitMinor));
  const creditMinor = totalMinor(lines.map((l) => l.creditMinor));
  if (debitMinor <= 0 || debitMinor !== creditMinor) throw new Error('JOURNAL_UNBALANCED');
  return { debitMinor, creditMinor };
}
export function periodBounds(period: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('PERIOD_INVALID');
  const [year, month] = period.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${last}` };
}
