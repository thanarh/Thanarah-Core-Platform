import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
function ui() {
  const source = readFileSync('public/customer/app.js', 'utf8');
  const ending = /\n init\(\);\s*\}\)\(\);?\s*$/u;
  if (!ending.test(source)) throw new Error('Customer UI boot changed; update the isolated renderer harness.');
  const app = { innerHTML: '' };
  const retryButton = { addEventListener: () => undefined };
  const context = {
    window: { JourneyApi: {} }, document: { getElementById: (id: string) => id === 'app' ? app : retryButton },
    crypto: { randomUUID: () => 'synthetic-operation' },
    location: { origin: 'https://example.test', search: '' }, URL, URLSearchParams,
    app,
    testRender: undefined as unknown as (data: unknown) => string,
    testOperation: undefined as unknown as (key: string, run: (id: string) => Promise<unknown>) => Promise<unknown>,
    testJourney: undefined as unknown as (data: unknown) => string,
    testRestoreError: undefined as unknown as (error: { message?: string }) => void,
  };
  runInNewContext(source.replace(ending,
    '\n globalThis.testRender=renderDetail;globalThis.testOperation=operationCall;globalThis.testJourney=(data)=>customerJourneyMarkup(data);globalThis.testDashboard=(data)=>customerDashboardMarkup(data);globalThis.testFilterOrders=filterCustomerOrders;globalThis.testDocuments=(order,documents)=>documentRequirementsMarkup(order,documents);globalThis.testProgress=(order)=>orderProgressMarkup(order);globalThis.testCatalogIssue=catalogOrderIssue;globalThis.testConfiguredPackages=configuredPackages;globalThis.testRestoreError=sessionRestoreError;\n})();'), context);
  return context;
}
function detail(status: string, available = false) {
  return {
    order: { _id: 'synthetic-order', status, packageCode: 'Lite', purpose: 'NEW',
      profile: {}, requirements: [], termsText: 'Synthetic terms only', termsVersion: 2,
      open: !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(status), createdAt: new Date(),
    }, documents: [], events: [], invoices: [], review: null,
    delivery: { available, url: available ? '/clinic-setup/' : null },
  };
}
describe('Customer portal state and uncertain-operation regression', () => {
  it('guides new customers to finish their clinic profile before starting a request', () => {
    const html = ui().testJourney({ account: { profile: {} }, orders: [] });
    expect(html).toContain('data-journey-action="profile"');
    expect(html).toContain('أكمل ملف المنشأة');
    expect(html).toContain('aria-current="step"');
  });
  it('offers a first request after the clinic profile is complete', () => {
    const profile = {
      legalName: 'Synthetic Clinic', displayName: 'Synthetic Clinic',
      registrationNumber: 'SYNTHETIC', city: 'Test', address: 'Test',
      contactName: 'Synthetic Contact', phoneE164: '+966500000001',
    };
    const html = ui().testJourney({ account: { profile }, orders: [] });
    expect(html).toContain('data-journey-action="new-order"');
    expect(html).toContain('ابدأ طلبك الأول');
  });
  it('summarizes the customer dashboard from real order statuses', () => {
    const orders = [
      { status: 'DRAFT' }, { status: 'CHANGES_REQUESTED' }, { status: 'SUBMITTED' },
      { status: 'ACTIVE' }, { status: 'DELIVERED' }, { status: 'CANCELLED' },
    ];
    const html = ui().testDashboard({ orders });
    expect(html).toContain('<span>إجمالي الطلبات</span><strong>6</strong>');
    expect(html).toContain('<span>تحتاج إلى إجراء</span><strong>2</strong>');
    expect(html).toContain('<span>قيد المتابعة</span><strong>1</strong>');
    expect(html).toContain('<span>عيادات مفعّلة</span><strong>2</strong>');
  });
  it('filters order history by actionable, review, active, and closed states', () => {
    const filter = ui().testFilterOrders;
    const orders = [
      { status: 'DRAFT' }, { status: 'CHANGES_REQUESTED' }, { status: 'SUBMITTED' },
      { status: 'APPROVED' }, { status: 'ACTIVE' }, { status: 'DELIVERED' },
      { status: 'REJECTED' }, { status: 'CANCELLED' },
    ];
    expect(filter(orders, 'action')).toHaveLength(2);
    expect(filter(orders, 'review')).toHaveLength(2);
    expect(filter(orders, 'active')).toHaveLength(2);
    expect(filter(orders, 'closed')).toHaveLength(2);
    expect(filter(orders, 'all')).toHaveLength(8);
  });
  it('blocks orders until real package details and published terms exist', () => {
    const h = ui();
    const empty = { registrationOpen: true, ordersOpen: true, termsText: '', packages: [
      { code: 'Lite', published: true, description: '', features: [] },
    ] };
    expect(h.testConfiguredPackages(empty)).toHaveLength(0);
    expect(h.testCatalogIssue(empty)).toContain('شروط تقديم الطلب');
    const configured = { registrationOpen: true, ordersOpen: true, termsText: 'Approved terms', packages: [
      { code: 'Pro', published: true, description: 'Approved package description', features: [] },
      { code: 'Draft', published: false, description: 'Not published', features: [] },
    ] };
    expect(h.testConfiguredPackages(configured)).toHaveLength(1);
    expect(h.testCatalogIssue(configured)).toBeNull();
    expect(h.testCatalogIssue({ ...configured, ordersOpen: false })).toContain('غير متاح');
    expect(h.testCatalogIssue({ ...configured, ordersOpen: false }, true)).toBeNull();
  });
  it('routes an existing request to its details and reflects its current stage', () => {
    const profile = {
      legalName: 'Synthetic Clinic', displayName: 'Synthetic Clinic',
      registrationNumber: 'SYNTHETIC', city: 'Test', address: 'Test',
      contactName: 'Synthetic Contact', phoneE164: '+966500000001',
    };
    const html = ui().testJourney({ account: { profile }, orders: [
      { _id: 'synthetic-order', status: 'SUBMITTED', updatedAt: '2026-01-01T00:00:00Z' },
    ] });
    expect(html).toContain('data-journey-action="open-order"');
    expect(html).toContain('data-order-id="synthetic-order"');
    expect(html).toContain('طلبك لدى الفريق للمراجعة');
  });
  it('marks the full journey complete only after customer receipt', () => {
    const profile = {
      legalName: 'Synthetic Clinic', displayName: 'Synthetic Clinic',
      registrationNumber: 'SYNTHETIC', city: 'Test', address: 'Test',
      contactName: 'Synthetic Contact', phoneE164: '+966500000001',
    };
    const html = ui().testJourney({ account: { profile }, orders: [
      { _id: 'synthetic-order', status: 'DELIVERED', updatedAt: '2026-01-01T00:00:00Z' },
    ] });
    expect(html).toContain('عرض استلام العيادة');
    expect(html.match(/class="is-complete"/gu)).toHaveLength(5);
  });
  it('offers acknowledgment only while the checked account awaits receipt', () => {
    const render = ui().testRender;
    expect(render(detail('ACTIVE', true))).toContain('id="acknowledge"');
    expect(render(detail('ACTIVE', false))).not.toContain('id="acknowledge"');
    expect(render(detail('APPROVED'))).not.toContain('id="acknowledge"');
  });
  it('shows required-document status and review feedback in the order details', () => {
    const html = ui().testDocuments(
      { requirements: [{ key: 'registration', label: 'السجل التجاري', required: true }] },
      [{ key: 'registration', fileName: 'record.pdf', status: 'REJECTED', reason: 'الصورة غير واضحة' }],
    );
    expect(html).toContain('السجل التجاري');
    expect(html).toContain('مطلوب استكمال');
    expect(html).toContain('الصورة غير واضحة');
  });
  it('marks the next customer action at each request stage', () => {
    const render = ui().testProgress;
    expect(render({ status: 'DRAFT' })).toContain('aria-current="step"');
    expect(render({ status: 'CHANGES_REQUESTED' })).toContain('استكمال المطلوب');
    expect(render({ status: 'SUBMITTED' })).toContain('مراجعة الفريق');
    expect(render({ status: 'APPROVED' })).toContain('تجهيز العيادة');
    expect(render({ status: 'ACTIVE' })).toContain('استلام العيادة');
    expect(render({ status: 'DELIVERED' }).match(/class="is-complete"/gu)).toHaveLength(5);
  });
  it('offers feedback and renewal only after the customer has acknowledged delivery', () => {
    const render = ui().testRender;
    expect(render(detail('DELIVERED', true))).toContain('id="review-form"');
    expect(render(detail('DELIVERED', true))).not.toContain('id="acknowledge"');
    expect(render(detail('DELIVERED', true))).toContain('id="renew"');
    expect(render(detail('REJECTED'))).not.toContain('id="renew"');
    expect(render(detail('CANCELLED'))).not.toContain('id="renew"');
  });
  it('shows invoice drafts before activation without presenting them as issued', () => {
    const d = { ...detail('APPROVED'), invoices: [
      { _id: 'synthetic-invoice', number: null, status: 'DRAFT', totalMinor: '10006' },
    ] };
    expect(ui().testRender(d)).toContain('مسودة غير صادرة');
  });
  it('does not lock unrelated mutations after the known unconfigured WhatsApp rejection', async () => {
    const call = ui().testOperation;
    await expect(call('whatsapp', async () => {
      throw { status: 503, code: 'CUSTOMER_WHATSAPP_UNAVAILABLE' };
    })).rejects.toMatchObject({ code: 'CUSTOMER_WHATSAPP_UNAVAILABLE' });
    expect(await call('profile', async () => 42)).toBe(42);
  });
  it('retains the operation reference on an uncertain server failure until the same action resolves', async () => {
    const call = ui().testOperation;
    await expect(call('profile', async () => { throw { status: 503 }; })).rejects.toMatchObject({ status: 503 });
    expect(() => call('create-order', async () => 42)).toThrow('هناك عملية سابقة غير مؤكدة');
    expect(await call('profile', async () => 42)).toBe(42);
    expect(await call('create-order', async () => 43)).toBe(43);
  });
  it('offers retry instead of presenting a temporary session outage as logout', () => {
    const h = ui();
    h.testRestoreError({ message: 'Service temporarily unavailable' });
    expect(h.app.innerHTML).toContain('لم يتم إنهاء الجلسة');
    expect(h.app.innerHTML).toContain('id="retry-session"');
    expect(h.app.innerHTML).not.toContain('id="auth-form"');
  });
});
