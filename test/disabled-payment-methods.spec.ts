import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function paymentMethodsMarkup() {
  const source = readFileSync('public/finance/app.js', 'utf8');
  const ending = /\}\)\(\);\s*$/u;
  if (!ending.test(source))
    throw new Error('Finance UI boot changed; update the isolated renderer harness.');
  const context = {
    window: {
      ThanarahApi: { restoreSession: async () => false },
      addEventListener: () => undefined,
    },
    document: {
      addEventListener: () => undefined,
      getElementById: () => ({ innerHTML: '' }),
    },
    testPaymentMethods: undefined as unknown as () => string,
  };
  const testHook = '\n globalThis.testPaymentMethods = futurePaymentMethodsMarkup;\n})();';
  runInNewContext(source.replace(ending, testHook), context);
  return context.testPaymentMethods();
}

describe('upcoming payment methods', () => {
  it('shows card and Apple Pay as disabled without enabling a payment action', () => {
    const html = paymentMethodsMarkup();
    expect(html).toContain('data-payment-method="card" type="button" disabled');
    expect(html).toContain('data-payment-method="apple-pay" type="button" disabled');
    expect(html.match(/قريبًا/gu)).toHaveLength(2);
    expect(html).not.toContain('data-action');
  });

  it('adds the same disabled choices to both billing flows', () => {
    const source = readFileSync('public/finance/app.js', 'utf8');
    expect(source.match(/futurePaymentMethodsMarkup\(\)/gu)).toHaveLength(3);
  });
});
