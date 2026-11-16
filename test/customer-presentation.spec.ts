import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function formatter() {
  const context = { window: {} as Record<string, unknown> };
  runInNewContext(readFileSync('public/assets/thanarah-currency.js', 'utf8'), context);
  runInNewContext(readFileSync('public/journey/presentation.js', 'utf8'), context);
  return context.window.JourneyFormat as {
    orderStatus: (value: string) => string;
    documentStatus: (value: string) => string;
    invoiceStatus: (value: string) => string;
    eventAction: (value: string) => string;
    money: (value: string | null) => string;
  };
}

describe('customer journey presentation', () => {
  it('formats Saudi currency without mixing decimal digit systems', () => {
    const format = formatter();
    expect(format.money('10006')).toContain('١٠٠٫٠٦');
    expect(format.money('10006')).toContain('src="/assets/saudi-riyal-symbol.png"');
    expect(format.money('10006')).not.toContain('ر.س');
    expect(format.money('0')).toContain('٠٫٠٠');
    expect(format.money('0')).toContain('src="/assets/saudi-riyal-symbol.png"');
    expect(format.money(null)).toBe('—');
  });

  it('uses Arabic labels for journey states and audit actions', () => {
    const format = formatter();
    expect(format.orderStatus('CHANGES_REQUESTED')).toBe('مطلوب استكمال');
    expect(format.documentStatus('PENDING')).toBe('بانتظار المراجعة');
    expect(format.invoiceStatus('PAID')).toBe('مسددة بتحويل معتمد');
    expect(format.eventAction('customer.admin.assign')).toBe('تعيين مسؤول الحساب');
    expect(format.eventAction('unknown.event')).toBe('unknown.event');
  });
});
