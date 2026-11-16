import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function currencyFormatter() {
  const context = { window: {} as Record<string, unknown> };
  runInNewContext(readFileSync('public/assets/thanarah-currency.js', 'utf8'), context);
  return context.window.ThanarahCurrency as {
    symbolMarkup: () => string;
    valueMarkup: (amount: string, currencyCode?: string) => string;
  };
}

describe('Saudi riyal symbol formatting', () => {
  it('uses the supplied transparent symbol asset for Saudi-riyal amounts', () => {
    const currency = currencyFormatter();
    const markup = currency.valueMarkup('١٬٢٣٤٫٥٦');

    expect(existsSync('public/assets/saudi-riyal-symbol.png')).toBe(true);
    expect(markup).toContain('<bdi');
    expect(markup).toContain('src="/assets/saudi-riyal-symbol.png"');
    expect(markup).toContain('alt="رمز الريال السعودي"');
    expect(markup).not.toContain('ر.س');
    expect(markup).not.toContain('SAR');
  });

  it('keeps non-Saudi currencies as escaped ISO codes', () => {
    const markup = currencyFormatter().valueMarkup('50.00', 'USD');

    expect(markup).toContain('50.00 USD');
    expect(markup).not.toContain('saudi-riyal-symbol.png');
  });

  it.each([
    ['public/site/index.html', '/site/app.js'],
    ['public/welcome/index.html', '/site/app.js'],
    ['public/customer/index.html', '/customer/app.js'],
    ['public/customer-admin/index.html', '/customer-admin/app.js'],
    ['public/company/index.html', '/company/app.js'],
    ['public/finance/index.html', '/finance/app.js'],
  ])('loads the currency formatter before the UI in %s', (path, appScript) => {
    const html = readFileSync(path, 'utf8');

    expect(html.indexOf('/assets/thanarah-currency.js')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('/assets/thanarah-currency.js')).toBeLessThan(html.indexOf(appScript));
  });

  it('escapes amount text before returning HTML markup', () => {
    const markup = currencyFormatter().valueMarkup('<img onerror=alert(1)>');

    expect(markup).toContain('&lt;img onerror=alert(1)&gt;');
    expect(markup).not.toContain('<img onerror');
  });
});
