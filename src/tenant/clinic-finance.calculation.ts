import type {
  ClinicInvoiceLineInput,
  ClinicInvoiceTaxPolicy,
  ClinicInvoiceTotals,
  InvoiceRoundingMethod,
} from './clinic-finance.model';

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ISO_CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));

export function isSupportedCurrencyCode(value: string): boolean {
  return CURRENCY_CODE_PATTERN.test(value) && ISO_CURRENCY_CODES.has(value);
}

export function currencyFractionDigits(currencyCode: string): number {
  if (!isSupportedCurrencyCode(currencyCode)) throw new RangeError('Unsupported currency code');
  return (
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function formatClinicInvoiceNumber(
  prefix: string,
  sequence: number,
  minimumDigits: number,
): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('Invoice sequence must be a positive safe integer');
  }
  return `${prefix}${String(sequence).padStart(minimumDigits, '0')}`;
}

export function calculateClinicInvoiceTotals(
  lines: readonly ClinicInvoiceLineInput[],
  taxPolicy: ClinicInvoiceTaxPolicy,
  lineRounding: InvoiceRoundingMethod,
): ClinicInvoiceTotals {
  const lineTotalsMinor = lines.map((line) =>
    roundRatio(
      BigInt(assertSafeInteger(line.unitPriceMinor)) *
        BigInt(assertSafeInteger(line.quantityMilli)),
      1_000n,
      lineRounding,
    ),
  );
  const subtotal = lineTotalsMinor.reduce((sum, amount) => sum + amount, 0n);
  const tax = taxPolicy.type === 'NO_TAX' ? 0n : calculateTax(subtotal, lineTotalsMinor, taxPolicy);
  const total = subtotal + tax;

  return {
    subtotalMinor: toSafeNumber(subtotal),
    taxMinor: toSafeNumber(tax),
    totalMinor: toSafeNumber(total),
    lineTotalsMinor: lineTotalsMinor.map(toSafeNumber),
  };
}

function calculateTax(
  subtotal: bigint,
  lineTotals: readonly bigint[],
  policy: Extract<ClinicInvoiceTaxPolicy, { type: 'RATE' }>,
): bigint {
  const rate = BigInt(assertSafeInteger(policy.rateBasisPoints));
  if (policy.calculation === 'SUBTOTAL') {
    return roundRatio(subtotal * rate, 10_000n, policy.rounding);
  }
  return lineTotals.reduce(
    (sum, lineTotal) => sum + roundRatio(lineTotal * rate, 10_000n, policy.rounding),
    0n,
  );
}

function roundRatio(
  numerator: bigint,
  denominator: bigint,
  rounding: InvoiceRoundingMethod,
): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Invalid non-negative amount');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (rounding === 'DOWN' || remainder === 0n) return quotient;
  if (rounding === 'UP') return quotient + 1n;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function assertSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Amount must be a non-negative safe integer');
  }
  return value;
}

function toSafeNumber(value: bigint): number {
  if (value > MAX_SAFE_BIGINT) throw new RangeError('Calculated amount exceeds safe range');
  return Number(value);
}
