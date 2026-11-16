import { TenantStorageProvider, TenantStorageTargetStatus } from '@prisma/client';
import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { MongoTenantClinicFinanceStorage } from '../src/tenant/mongo-tenant-clinic-finance.storage';
import type {
  TrustedPatientPortalContext,
  TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';
import type { TenantMongoClientManager } from '../src/tenant/tenant-mongo-client.manager';
import type { TenantStorageRoute } from '../src/tenant/tenant-storage.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from '../src/tenant/tenant-storage.errors';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from '../src/tenant/tenant-storage.registry';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '55555555-5555-4555-8555-555555555555';
const targetId = '44444444-4444-4444-8444-444444444444';
const context = {
  tenantId,
  membershipId: '22222222-2222-4222-8222-222222222222',
  platformUserId: '33333333-3333-4333-8333-333333333333',
} as TrustedTenantContext;
const target: TenantStorageTargetRecord = {
  id: targetId,
  tenantId,
  provider: TenantStorageProvider.MONGODB,
  connectionReference: 'primary',
  databaseName: 'tenant_finance',
  status: TenantStorageTargetStatus.ACTIVE,
  isPrimary: true,
  createdAt: new Date('2026-11-09T00:00:00.000Z'),
  updatedAt: new Date('2026-11-09T00:00:00.000Z'),
};
const route: TenantStorageRoute = {
  placements: [
    { placementId: targetId as TenantStorageRoute['placements'][number]['placementId'] },
  ],
};

function setup(options: { hasSettingsIndex?: boolean; targetTenantId?: string } = {}) {
  let lastInvoiceFilter: Record<string, unknown> | undefined;
  const settings = {
    indexes: vi.fn().mockResolvedValue(
      options.hasSettingsIndex === false
        ? [{ name: '_id_', key: { _id: 1 } }]
        : [
            { name: '_id_', key: { _id: 1 } },
            {
              name: 'clinic_finance_settings_tenant_unique',
              key: { _tenantId: 1 },
              unique: true,
            },
          ],
    ),
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };
  const invoices = {
    find: vi.fn((filter: Record<string, unknown>) => {
      lastInvoiceFilter = filter;
      return cursor;
    }),
    countDocuments: vi.fn().mockResolvedValue(0),
  };
  const database = {
    collection: vi.fn((name: string) => (name === 'clinic_finance_settings' ? settings : invoices)),
  } as unknown as Db;
  const targetResolver: TenantStorageTargetResolver = {
    findActivePrimaryTarget: vi.fn(async (receivedContext, receivedPlacement) => {
      if (
        receivedContext.tenantId !== (options.targetTenantId ?? tenantId) ||
        receivedPlacement !== targetId
      ) {
        return null;
      }
      return { ...target, tenantId: options.targetTenantId ?? tenantId };
    }),
  };
  const clients = { getDatabase: vi.fn().mockResolvedValue(database) };
  const storage = new MongoTenantClinicFinanceStorage(
    targetResolver,
    clients as unknown as TenantMongoClientManager,
  );
  return {
    storage,
    targetResolver,
    clients,
    settings,
    invoices,
    getLastInvoiceFilter: () => lastInvoiceFilter,
  };
}

describe('MongoTenantClinicFinanceStorage', () => {
  it('reads only through the active tenant placement and returns SAR as an unconfigured default', async () => {
    const state = setup();
    const settings = await state.storage.getSettings(context, route);

    expect(settings).toMatchObject({
      tenantId,
      version: 0,
      currencyCode: 'SAR',
      lineRounding: null,
      taxPolicies: [],
      numberingPolicy: null,
    });
    expect(state.targetResolver.findActivePrimaryTarget).toHaveBeenCalledWith(context, targetId);
    expect(state.clients.getDatabase).toHaveBeenCalledWith(target);
  });

  it('fails closed when tenant-scoped settings uniqueness is not provisioned', async () => {
    const state = setup({ hasSettingsIndex: false });

    await expect(state.storage.getSettings(context, route)).rejects.toBeInstanceOf(
      TenantStorageUnavailableError,
    );
    expect(state.settings.findOne).not.toHaveBeenCalled();
  });

  it('queries only issued invoices for the verified patient in the trusted tenant', async () => {
    const state = setup();
    const patientContext = {
      tenantId,
      platformUserId: context.platformUserId,
    } as TrustedPatientPortalContext;

    await expect(
      state.storage.listPatientInvoices(
        patientContext,
        route,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).resolves.toEqual([]);
    expect(state.getLastInvoiceFilter()).toEqual({
      _tenantId: tenantId,
      patientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'ISSUED',
      totals: { $ne: null },
    });
  });

  it('preserves the sequential counter across setting changes and numbering modes', async () => {
    const state = setup();
    const current = {
      _id: tenantId,
      _tenantId: tenantId,
      version: 4,
      currencyCode: 'SAR',
      lineRounding: 'HALF_UP',
      customFields: [],
      taxPolicies: [],
      numberingPolicy: {
        mode: 'SEQUENTIAL',
        prefix: 'INV-',
        minimumDigits: 3,
        startingNumber: 1,
      },
      nextSequence: 27,
      updatedAt: new Date('2026-11-09T00:00:00.000Z'),
      updatedBy: context.platformUserId,
      revisions: [],
      pendingIssue: null,
    };
    state.settings.findOne
      .mockReset()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({
        ...current,
        version: 5,
        numberingPolicy: {
          mode: 'MANUAL',
          prefix: 'M-',
          minimumDigits: 3,
        },
      });

    const updated = await state.storage.saveSettings(
      context,
      route,
      {
        expectedVersion: 4,
        currencyCode: 'SAR',
        lineRounding: 'HALF_UP',
        customFields: [],
        taxPolicies: [],
        numberingPolicy: {
          mode: 'MANUAL',
          prefix: 'M-',
          minimumDigits: 3,
        },
      },
      context.platformUserId,
      new Date('2026-11-09T00:01:00.000Z'),
    );

    expect(updated?.nextSequence).toBe(27);
    expect(state.settings.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ version: 4, _tenantId: tenantId }),
      expect.objectContaining({
        $set: expect.objectContaining({ nextSequence: 27 }),
      }),
    );
  });

  it('does not route a trusted tenant context into another tenant database', async () => {
    const state = setup();
    const otherContext = {
      ...context,
      tenantId: otherTenantId,
    } as TrustedTenantContext;

    await expect(
      state.storage.listInvoices(otherContext, route, {
        limit: 50,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(TenantStorageNotConfiguredError);
    expect(state.clients.getDatabase).not.toHaveBeenCalled();
  });

  it('includes the tenant partition in invoice search filters', async () => {
    const state = setup();

    await state.storage.listInvoices(context, route, {
      limit: 25,
      offset: 0,
      search: 'INV',
    });

    expect(state.getLastInvoiceFilter()).toMatchObject({
      _tenantId: tenantId,
      $or: [
        { recipientName: expect.any(RegExp) },
        { invoiceNumber: expect.any(RegExp) },
        { manualInvoiceNumber: expect.any(RegExp) },
      ],
    });
  });
});
