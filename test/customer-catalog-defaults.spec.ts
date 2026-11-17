import { describe, expect, it } from 'vitest';
import { JourneyAccounts } from '../src/customer-journey/journey.accounts';
import {
  catalogSchema,
  defaultCatalog,
  profileInputSchema,
  profileSchema,
} from '../src/customer-journey/journey.model';
import type { JourneyStore } from '../src/customer-journey/journey.store';

function accountsFor(catalog: ReturnType<typeof defaultCatalog>) {
  const store = {
    run: async (work: (tx: unknown) => unknown) => work({}),
    catalog: async () => catalog,
  } as unknown as JourneyStore;
  return new JourneyAccounts(store, {} as never, {} as never, {} as never);
}

describe('customer catalog defaults', () => {
  it('keeps owner-provided package details in draft and blocks orders by default', () => {
    const catalog = defaultCatalog();
    expect(catalog.live).toBeNull();
    expect(catalog.draft.registrationOpen).toBe(true);
    expect(catalog.draft.ordersOpen).toBe(false);
    expect(catalog.draft.termsText).toBe('');
    expect(catalog.draft.services.map((item) => item.key)).toEqual([
      'clinic-operations',
      'team-access',
    ]);
    expect(catalog.draft.services.every((item) => item.published)).toBe(true);
    expect(catalog.draft.packages.map((item) => item.priceMinor)).toEqual([
      '19900',
      '35900',
      null,
    ]);
    expect(catalog.draft.packages.map((item) => item.published)).toEqual([true, true, true]);
    expect(catalog.draft.packages[0].features).toEqual([
      'إدارة المرضى والمواعيد والزيارات',
      'تنظيم أدوار الفريق',
    ]);
    expect(catalog.draft.packages[1].features).toEqual([
      'إدارة المرضى والمواعيد والزيارات',
      'تنظيم أدوار الفريق',
    ]);
    expect(catalog.draft.packages[2].features).toEqual([]);
    expect(catalog.draft.documents.map((item) => item.key)).toEqual([
      'commercial-register',
      'vat-certificate',
      'clinic-logo',
    ]);
    expect(catalog.draft.packages[0].description).toContain('مسودة تجريبية');
    expect(catalog.draft.termsText).toBe('');
  });

  it('requires a tax number on new profiles while reading older saved profiles', () => {
    const oldProfile = {
      legalName: 'Test clinic',
      displayName: 'Test clinic',
      registrationNumber: 'TEST-REG',
      city: 'Riyadh',
      address: 'Test address',
      contactName: 'Test contact',
      phoneE164: '+966500000001',
    };
    expect(profileSchema.safeParse(oldProfile).success).toBe(true);
    expect(profileInputSchema.safeParse(oldProfile).success).toBe(false);
    expect(profileInputSchema.safeParse({ ...oldProfile, taxNumber: 'TEST-VAT' }).success).toBe(
      true,
    );
  });

  it('shows a clearly marked demo catalog without enabling registration or orders', async () => {
    const catalog = defaultCatalog();
    const published = await accountsFor(catalog).publicCatalog();
    expect(published.demo).toBe(true);
    expect(published.registrationOpen).toBe(true);
    expect(published.ordersOpen).toBe(false);
    expect(published.termsText).toBe('');
    expect(published.services.map((item) => item.key)).toEqual([
      'clinic-operations',
      'team-access',
    ]);
    expect(published.documents).toEqual([]);
    expect(published.packages.map((item) => item.code)).toEqual(['Lite', 'Pro', 'Customize']);
    expect(published.packages.map((item) => item.priceMinor)).toEqual(['19900', '35900', null]);
    expect(published.packages.every((item) => item.published)).toBe(true);
  });

  it('does not expose a saved but unpublished draft as the public demo catalog', async () => {
    const catalog = defaultCatalog();
    catalog.draft.services[0].description = 'Unreviewed private draft details';
    catalog.draft.packages[0].priceMinor = '99900';
    const published = await accountsFor(catalog).publicCatalog();
    expect(published.services[0].description).not.toContain('Unreviewed private draft details');
    expect(published.packages[0].priceMinor).toBe('19900');
  });

  it('exposes only independently published package content', async () => {
    const catalog = defaultCatalog();
    const live = structuredClone(catalog.draft);
    live.termsText = 'Approved test terms for this synthetic catalog.';
    live.packages[0].published = true;
    live.packages[2].published = true;
    live.packages[1].published = false;
    catalog.live = live;
    catalog.liveVersion = 1;
    const published = await accountsFor(catalog).publicCatalog();
    expect(published.demo).toBe(false);
    expect(published.termsText).toBe('Approved test terms for this synthetic catalog.');
    expect(published.packages.map((item) => item.code)).toEqual(['Lite', 'Customize']);
    expect(published.packages.map((item) => item.priceMinor)).toEqual(['19900', null]);
  });

  it('preserves prior order intake settings when loading a catalog without the new toggle', () => {
    const catalog = defaultCatalog();
    const legacyDraft = { ...catalog.draft };
    Reflect.deleteProperty(legacyDraft, 'ordersOpen');
    const legacy = catalogSchema.parse({ ...catalog, draft: legacyDraft });
    expect(legacy.draft.ordersOpen).toBe(legacy.draft.registrationOpen);
  });
});
