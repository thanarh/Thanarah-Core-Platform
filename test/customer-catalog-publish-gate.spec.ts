import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { JourneyStore } from '../src/customer-journey/journey.store';
import { JourneyAdmin } from '../src/customer-journey/journey.admin';
import { defaultCatalog } from '../src/customer-journey/journey.model';

function reviewableCatalog(): ReturnType<typeof defaultCatalog> {
  const catalog = defaultCatalog();
  catalog.updatedBy = randomUUID();
  catalog.draft.termsText = 'Synthetic approved terms for catalog testing.';
  catalog.draft.services = catalog.draft.services.map((service) => ({
    ...service,
    description: 'Approved synthetic service description.',
  }));
  catalog.draft.packages = catalog.draft.packages.map((item) => ({
    ...item,
    description: 'Approved synthetic package description.',
  }));
  return catalog;
}

function adminFor(catalog: ReturnType<typeof defaultCatalog>): JourneyAdmin {
  const store = {
    catalog: async (): Promise<ReturnType<typeof defaultCatalog>> => catalog,
    adminCommand: async (
      _userId: string,
      _operationId: string,
      _action: string,
      _input: unknown,
      _permission: string,
      run: (work: unknown) => Promise<{ result: unknown; orderId: string }>,
    ): Promise<unknown> => {
      const result = await run({ actor: { permissions: [] }, session: {} });
      return result.result;
    },
  };
  return new JourneyAdmin(store as unknown as JourneyStore, {} as never, {} as never);
}

describe('customer catalog publication gate', () => {
  it.each(['terms', 'service', 'package', 'feature'])(
    'rejects a remaining demo marker in %s',
    async (location) => {
      const catalog = reviewableCatalog();
      if (location === 'terms') catalog.draft.termsText = 'مسودة تجريبية للشروط.';
      if (location === 'service') catalog.draft.services[0].description = 'وصف خدمة تجريبي.';
      if (location === 'package') catalog.draft.packages[0].description = 'وصف باقة تجريبي.';
      if (location === 'feature') catalog.draft.packages[0].features = ['ميزة تجريبية.'];
      const admin = adminFor(catalog);

      await expect(
        admin.publish(randomUUID(), {
          operationId: randomUUID(),
          version: catalog.version,
          reason: 'Independent synthetic review',
        }),
      ).rejects.toMatchObject({ code: 'CUSTOMER_CATALOG_DEMO_CONTENT' });
    },
  );
});
