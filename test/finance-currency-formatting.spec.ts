import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function financeFormatters() {
  const context = {
    window: {
      ThanarahApi: { restoreSession: async () => false },
      addEventListener: () => undefined,
    },
    document: {
      addEventListener: () => undefined,
      getElementById: () => ({ innerHTML: '' }),
    },
    testFormatters: undefined as unknown as {
      formatMinor: (minor: number, currency: string) => string;
      moneyText: (minor: number, currency: string) => string;
      settingsMarkup: (settings: Record<string, unknown>, writable: boolean) => string;
    },
  };
  runInNewContext(readFileSync('public/assets/thanarah-currency.js', 'utf8'), context);
  const source = readFileSync('public/finance/app.js', 'utf8');
  const ending = /\}\)\(\);\s*$/u;
  if (!ending.test(source))
    throw new Error('Finance app boot changed; update the formatter harness.');
  const testHook =
    '\n globalThis.testFormatters = { formatMinor, moneyText, settingsMarkup };\n})();';
  runInNewContext(source.replace(ending, testHook), context);
  return context.testFormatters;
}

describe('clinic finance amount formatting', () => {
  it('uses the supplied symbol for all Saudi-riyal amount views', () => {
    const format = financeFormatters();
    for (const output of [format.formatMinor(123456, 'SAR'), format.moneyText(123456, 'SAR')]) {
      expect(output).toContain('src="/assets/saudi-riyal-symbol.png"');
      expect(output).not.toContain(' SAR');
      expect(output).not.toContain('ر.س');
    }
  });

  it('preserves other currency codes', () => {
    const output = financeFormatters().formatMinor(123456, 'USD');

    expect(output).toContain('USD');
    expect(output).not.toContain('saudi-riyal-symbol.png');
  });

  it('uses the symbol in the clinic currency settings summary', () => {
    const output = financeFormatters().settingsMarkup(
      {
        version: 1,
        currencyCode: 'SAR',
        lineRounding: null,
        numberingPolicy: null,
        nextSequence: null,
        taxPolicies: [],
        customFields: [],
        revisions: [],
      },
      false,
    );

    expect(output).toContain('src="/assets/saudi-riyal-symbol.png"');
    expect(output).not.toContain('<strong class="mono">SAR</strong>');
    expect(output).not.toContain('الريال السعودي هو العملة');
  });
});
