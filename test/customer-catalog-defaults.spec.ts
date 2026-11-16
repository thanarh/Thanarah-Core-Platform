import { describe, expect, it } from 'vitest';
import { JourneyAccounts } from '../src/customer-journey/journey.accounts';
import { catalogSchema, defaultCatalog } from '../src/customer-journey/journey.model';
import type { JourneyStore } from '../src/customer-journey/journey.store';

function accountsFor(catalog: ReturnType<typeof defaultCatalog>) {
  const store = {
    run: async (work: (tx: unknown) => unknown) => work({}),
    catalog: async () => catalog,
  } as unknown as JourneyStore;
  return new JourneyAccounts(store, {} as never, {} as never);
}

describe('customer catalog demo defaults', () => {
  it('keeps editable demo content in draft and blocks new orders by default', () => {
    const catalog = defaultCatalog();
    expect(catalog.live).toBeNull();
    expect(catalog.draft.registrationOpen).toBe(true);
    expect(catalog.draft.ordersOpen).toBe(false);
    expect(catalog.draft.termsText).toContain('مسودة تجريبية');
    expect(catalog.draft.packages.map((item) => item.priceMinor)).toEqual([
      '29900',
      '79900',
      '149900',
    ]);
    expect(catalog.draft.packages.every((item) => item.features.length > 0)).toBe(true);
  });

  it('does not expose draft prices, features, terms, or services publicly', async () => {
    const catalog = defaultCatalog();
    const published = await accountsFor(catalog).publicCatalog();
    expect(published.registrationOpen).toBe(true);
    expect(published.ordersOpen).toBe(false);
    expect(published.termsText).toBe('');
    expect(published.services).toEqual([]);
    expect(published.packages).toEqual([]);
  });

  it('exposes only independently published package content', async () => {
    const catalog = defaultCatalog();
    const live = structuredClone(catalog.draft);
    live.packages[1].published = false;
    catalog.live = live;
    catalog.liveVersion = 1;
    const published = await accountsFor(catalog).publicCatalog();
    expect(published.termsText).toContain('مسودة تجريبية');
    expect(published.packages.map((item) => item.code)).toEqual(['Lite', 'Customize']);
    expect(published.packages.map((item) => item.priceMinor)).toEqual(['29900', '149900']);
  });

  it('preserves prior order intake settings when loading a catalog without the new toggle', () => {
    const catalog = defaultCatalog();
    const legacyDraft = { ...catalog.draft };
    Reflect.deleteProperty(legacyDraft, 'ordersOpen');
    const legacy = catalogSchema.parse({ ...catalog, draft: legacyDraft });
    expect(legacy.draft.ordersOpen).toBe(legacy.draft.registrationOpen);
  });
});
