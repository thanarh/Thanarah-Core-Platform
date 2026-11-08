import { describe, expect, it } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import {
  ClinicFinanceInputError,
  ClinicFinanceSettingsConflictError,
  ClinicInvoiceIdempotencyConflictError,
  ClinicInvoiceNotFoundError,
  ClinicInvoicePolicyUnavailableError,
} from '../src/tenant/clinic-finance.errors';
import { ClinicFinanceService } from '../src/tenant/clinic-finance.service';
import { ClinicFinanceRepository } from '../src/tenant/clinic-finance.repository';
import { InMemoryClinicFinanceStorage } from '../src/tenant/tenant-clinic-finance.storage';
import { TrustedTenantContextFactoryService } from '../src/tenant/tenant-context.service';
import {
  DevelopmentTenantDatabaseRegistry,
  TenantStorageResolverService,
} from '../src/tenant/tenant-storage.resolver';
import type { TrustedTenantContext } from '../src/tenant/tenant-context.contract';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '55555555-5555-4555-8555-555555555555';
const membershipId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const taxPolicyId = '88888888-8888-4888-8888-888888888888';
const actor: AuthenticatedPlatformUser = {
  userId,
  sessionId: '44444444-4444-4444-8444-444444444444',
  tokenVersion: 1,
  platformRoleIds: [],
};

function trustedContext(
  scopeTenantId: string,
  scopeMembershipId = membershipId,
): TrustedTenantContext {
  return new TrustedTenantContextFactoryService().fromValidatedMembership({
    tenantId: scopeTenantId as never,
    membershipId: scopeMembershipId as never,
    platformUserId: userId,
  } as never);
}

function serviceFixture() {
  const storage = new InMemoryClinicFinanceStorage();
  const resolver = new TenantStorageResolverService(new DevelopmentTenantDatabaseRegistry());
  const repository = new ClinicFinanceRepository(storage, resolver);
  return new ClinicFinanceService(repository);
}

function invoiceInput(description = 'Clinic visit') {
  return {
    recipientName: 'Synthetic recipient',
    invoiceDate: '2026-11-09',
    customFieldValues: {},
    taxPolicyId,
    lines: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        description,
        quantityMilli: 1_000,
        unitPriceMinor: 12_500,
      },
    ],
  };
}

function settingsInput(expectedVersion = 0) {
  return {
    expectedVersion,
    currencyCode: 'SAR',
    lineRounding: 'HALF_UP' as const,
    customFields: [],
    taxPolicies: [{ id: taxPolicyId, name: 'Configured no-tax rule', type: 'NO_TAX' as const }],
    numberingPolicy: {
      mode: 'SEQUENTIAL' as const,
      prefix: 'INV-',
      minimumDigits: 3,
      startingNumber: 1,
    },
  };
}

describe('ClinicFinanceService', () => {
  it('keeps clinic finance scoped to the trusted tenant and actor', async () => {
    const service = serviceFixture();
    const contextA = trustedContext(tenantId);
    const contextB = trustedContext(otherTenantId, '66666666-6666-4666-8666-666666666666');

    const invoice = await service.createInvoice(
      contextA,
      { ...invoiceInput(), taxPolicyId: null },
      actor,
    );
    await expect(service.getInvoice(contextB, invoice.id)).rejects.toBeInstanceOf(
      ClinicInvoiceNotFoundError,
    );
    await expect(
      service.updateSettings(contextA, settingsInput(), {
        ...actor,
        userId: '77777777-7777-4777-8777-777777777777',
      }),
    ).rejects.toBeInstanceOf(ClinicFinanceInputError);
  });

  it('saves versioned settings, retries idempotently, reviews, then issues without payment', async () => {
    const service = serviceFixture();
    const context = trustedContext(tenantId);
    const settings = await service.updateSettings(context, settingsInput(), actor);
    expect(settings).toMatchObject({ version: 1, currencyCode: 'SAR', nextSequence: 1 });

    const input = invoiceInput();
    const created = await service.createInvoice(context, input, actor, 'finance-create-1');
    const retry = await service.createInvoice(context, input, actor, 'finance-create-1');
    expect(retry.id).toBe(created.id);
    expect(retry.status).toBe('DRAFT');

    await expect(
      service.createInvoice(context, invoiceInput('Different line'), actor, 'finance-create-1'),
    ).rejects.toBeInstanceOf(ClinicInvoiceIdempotencyConflictError);

    const reviewed = await service.reviewInvoice(
      context,
      created.id,
      { expectedVersion: created.version },
      actor,
    );
    expect(reviewed).toMatchObject({
      status: 'REVIEWED',
      totals: { subtotalMinor: 12_500, taxMinor: 0, totalMinor: 12_500 },
    });

    const issued = await service.issueInvoice(
      context,
      created.id,
      { expectedVersion: reviewed.version },
      actor,
    );
    expect(issued).toMatchObject({
      status: 'ISSUED',
      invoiceNumber: 'INV-001',
      currencyCode: 'SAR',
    });
    expect(issued).not.toHaveProperty('creationKeyHash');
    expect((await service.getSettings(context)).nextSequence).toBe(2);
  });

  it('records return-to-draft and accepts an explicitly configured manual numbering mode', async () => {
    const service = serviceFixture();
    const context = trustedContext(tenantId);
    await service.updateSettings(context, settingsInput(), actor);
    const invoice = await service.createInvoice(context, invoiceInput(), actor);
    const reviewed = await service.reviewInvoice(
      context,
      invoice.id,
      { expectedVersion: invoice.version },
      actor,
    );
    const returned = await service.returnToDraft(
      context,
      invoice.id,
      { expectedVersion: reviewed.version, reason: 'Correction requested' },
      actor,
    );
    expect(returned.status).toBe('DRAFT');
    expect(returned.history.at(-1)?.action).toBe('RETURNED_TO_DRAFT');

    const issuedDraft = await service.createInvoice(context, invoiceInput('Second line'), actor);
    const issuedReview = await service.reviewInvoice(
      context,
      issuedDraft.id,
      { expectedVersion: issuedDraft.version },
      actor,
    );
    await service.issueInvoice(
      context,
      issuedDraft.id,
      { expectedVersion: issuedReview.version },
      actor,
    );

    const manualSettings = {
      ...settingsInput(1),
      numberingPolicy: {
        mode: 'MANUAL' as const,
        prefix: 'M-',
        minimumDigits: 3,
      },
    };
    const saved = await service.updateSettings(context, manualSettings, actor);
    expect(saved.nextSequence).toBe(2);

    const reenabled = await service.updateSettings(
      context,
      {
        ...settingsInput(saved.version),
        numberingPolicy: {
          mode: 'SEQUENTIAL' as const,
          prefix: 'INV-',
          minimumDigits: 3,
          startingNumber: 1,
        },
      },
      actor,
    );
    expect(reenabled.nextSequence).toBe(2);

    const nextInvoice = await service.createInvoice(context, invoiceInput('Third line'), actor);
    const nextReview = await service.reviewInvoice(
      context,
      nextInvoice.id,
      { expectedVersion: nextInvoice.version },
      actor,
    );
    const nextIssued = await service.issueInvoice(
      context,
      nextInvoice.id,
      { expectedVersion: nextReview.version },
      actor,
    );
    expect(nextIssued.invoiceNumber).toBe('INV-002');
  });

  it('rejects stale settings versions and requires explicit policies before review', async () => {
    const service = serviceFixture();
    const context = trustedContext(tenantId);
    await service.updateSettings(context, settingsInput(), actor);
    await expect(service.updateSettings(context, settingsInput(0), actor)).rejects.toBeInstanceOf(
      ClinicFinanceSettingsConflictError,
    );

    const unconfigured = serviceFixture();
    const draft = await unconfigured.createInvoice(
      context,
      {
        ...invoiceInput(),
        taxPolicyId: null,
      },
      actor,
    );
    await expect(
      unconfigured.reviewInvoice(context, draft.id, { expectedVersion: draft.version }, actor),
    ).rejects.toBeInstanceOf(ClinicInvoicePolicyUnavailableError);
  });
});
