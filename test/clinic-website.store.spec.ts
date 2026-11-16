import { describe, expect, it, vi } from 'vitest';
import { ClinicWebsiteStore } from '../src/tenant/clinic-website.store';
import { defaultClinicWebsiteDraft } from '../src/tenant/clinic-website.model';

const tenantId = 'c1e91c17-1213-41fb-a84f-3ff4a8bed1e2';
const actorId = '6ee88479-8a21-4dd7-b92a-b2d750941a52';

type FakeRow = Record<string, unknown>;

function matches(row: FakeRow, filter: FakeRow): boolean {
  return Object.entries(filter).every(([key, value]) => {
    let found: unknown = row;
    for (const part of key.split('.')) {
      found =
        typeof found === 'object' && found !== null && part in found
          ? (found as Record<string, unknown>)[part]
          : undefined;
    }
    if (value && typeof value === 'object' && '$exists' in value) {
      return Boolean(found) === (value as { $exists: boolean }).$exists;
    }
    return found === value;
  });
}

function makeStore() {
  const data = new Map<string, Map<string, FakeRow>>();
  const collection = (name: string) => {
    let rows = data.get(name);
    if (!rows) {
      rows = new Map();
      data.set(name, rows);
    }
    return {
      updateOne: vi.fn(async (filter, update, options) => {
        if (options?.upsert && !rows!.has(filter._id)) {
          rows!.set(filter._id, structuredClone(update.$setOnInsert));
        }
      }),
      findOne: vi.fn(async (filter) => {
        const row =
          rows!.get(filter._id) || [...rows!.values()].find((item) => matches(item, filter));
        return row ? structuredClone(row) : null;
      }),
      replaceOne: vi.fn(async (filter, replacement) => {
        const current = rows!.get(filter._id as string);
        if (!current || current.version !== filter.version) return { matchedCount: 0 };
        rows!.set(filter._id as string, structuredClone(replacement));
        return { matchedCount: 1 };
      }),
      insertOne: vi.fn(async (row) => {
        rows!.set(row._id, structuredClone(row));
        return { acknowledged: true };
      }),
      find: vi.fn((filter) => {
        const selected = [...rows!.values()].filter((row) => matches(row, filter));
        return {
          sort: () => ({
            limit: () => ({ toArray: async () => structuredClone(selected) }),
          }),
        };
      }),
    };
  };
  const database = {
    collection,
  };
  data.set('tenants', new Map([[tenantId, { _id: tenantId, status: 'ACTIVE' }]]));
  const mongo = {
    getDatabase: vi.fn(async () => database),
    withTransaction: vi.fn(async (operation) => operation({})),
  };
  return {
    store: new ClinicWebsiteStore(
      mongo as unknown as ConstructorParameters<typeof ClinicWebsiteStore>[0],
    ),
    mongo,
    data,
  };
}

describe('ClinicWebsiteStore', () => {
  it('keeps draft edits and restoration separate from the published snapshot', async () => {
    const { store } = makeStore();
    const initial = await store.get(tenantId, actorId);
    expect(initial.currentVersion).toBe(0);

    const firstDraft = defaultClinicWebsiteDraft('clinic-first');
    firstDraft.brand.name = 'عيادة تجريبية';
    const saved = await store.saveDraft(tenantId, actorId, 0, firstDraft);
    expect(saved.currentVersion).toBe(1);

    const published = await store.publish(tenantId, actorId, 1);
    expect(published.publishedVersion).toBe(2);

    const nextDraft = { ...firstDraft, slug: 'clinic-second' };
    nextDraft.brand = { ...firstDraft.brand, name: 'مسودة جديدة' };
    const changed = await store.saveDraft(tenantId, actorId, 2, nextDraft);
    expect(changed.draft.slug).toBe('clinic-second');
    expect((await store.findPublishedBySlug('clinic-first')).draft.brand.name).toBe(
      'عيادة تجريبية',
    );
    await expect(store.findPublishedBySlug('clinic-second')).rejects.toMatchObject({
      status: 404,
    });

    const restored = await store.restore(tenantId, actorId, 1, 3);
    expect(restored.currentVersion).toBe(4);
    expect(restored.draft.slug).toBe('clinic-first');
    expect(restored.publishedVersion).toBe(2);
    expect((await store.findPublishedBySlug('clinic-first')).draft.brand.name).toBe(
      'عيادة تجريبية',
    );
  });

  it('rejects saves based on a stale version', async () => {
    const { store } = makeStore();
    await store.get(tenantId, actorId);
    await expect(
      store.saveDraft(tenantId, actorId, 9, defaultClinicWebsiteDraft('clinic-stale')),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects malformed drafts as a client input error', async () => {
    const { store } = makeStore();
    await store.get(tenantId, actorId);
    await expect(store.saveDraft(tenantId, actorId, 0, { slug: '<script>' })).rejects.toMatchObject(
      {
        status: 400,
      },
    );
  });
});
