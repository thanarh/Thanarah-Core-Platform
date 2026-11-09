import { HttpException, Inject, Injectable } from '@nestjs/common';
import { TENANT_STORAGE_RESOLVER } from './tenant-storage.resolver';
import type { TenantStorageResolver } from './tenant-storage.contract';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import type {
  ClinicInvoice,
  ClinicInvoiceListResult,
  ClinicInvoiceReviewedPolicy,
  ClinicInvoiceSettings,
  ClinicInvoiceTotals,
  ClinicInvoiceTransfer,
  ClinicInvoiceTransferStatus,
} from './clinic-finance.model';
import type {
  ListClinicInvoicesQuery,
  UpdateClinicFinanceSettingsInput,
  UpdateClinicInvoiceInput,
} from './clinic-finance.dto';
import {
  CLINIC_FINANCE_STORAGE,
  type ClinicFinanceStorage,
  type ClinicInvoiceCreateResult,
} from './tenant-clinic-finance.storage';

@Injectable()
export class ClinicFinanceRepository {
  constructor(
    @Inject(CLINIC_FINANCE_STORAGE) private readonly storage: ClinicFinanceStorage,
    @Inject(TENANT_STORAGE_RESOLVER) private readonly resolver: TenantStorageResolver,
  ) {}

  getSettings(context: TrustedTenantContext): Promise<ClinicInvoiceSettings> {
    return this.withRoute(context, (route) => this.storage.getSettings(context, route));
  }

  saveSettings(
    context: TrustedTenantContext,
    input: UpdateClinicFinanceSettingsInput,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoiceSettings | null> {
    return this.withRoute(context, (route) =>
      this.storage.saveSettings(context, route, input, actorUserId, at),
    );
  }

  createInvoice(
    context: TrustedTenantContext,
    invoice: ClinicInvoice,
  ): Promise<ClinicInvoiceCreateResult> {
    return this.withRoute(context, (route) => this.storage.createInvoice(context, route, invoice));
  }

  listInvoices(
    context: TrustedTenantContext,
    query: ListClinicInvoicesQuery,
  ): Promise<ClinicInvoiceListResult> {
    return this.withRoute(context, (route) => this.storage.listInvoices(context, route, query));
  }

  findInvoice(context: TrustedTenantContext, invoiceId: string): Promise<ClinicInvoice | null> {
    return this.withRoute(context, (route) => this.storage.findInvoice(context, route, invoiceId));
  }

  updateDraft(
    context: TrustedTenantContext,
    invoiceId: string,
    expectedVersion: number,
    patch: UpdateClinicInvoiceInput,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    return this.withRoute(context, (route) =>
      this.storage.updateDraft(context, route, invoiceId, expectedVersion, patch, actorUserId, at),
    );
  }

  reviewInvoice(
    context: TrustedTenantContext,
    invoiceId: string,
    expectedVersion: number,
    policy: ClinicInvoiceReviewedPolicy,
    totals: ClinicInvoiceTotals,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    return this.withRoute(context, (route) =>
      this.storage.reviewInvoice(
        context,
        route,
        invoiceId,
        expectedVersion,
        policy,
        totals,
        actorUserId,
        at,
      ),
    );
  }

  returnToDraft(
    context: TrustedTenantContext,
    invoiceId: string,
    expectedVersion: number,
    reason: string,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    return this.withRoute(context, (route) =>
      this.storage.returnToDraft(
        context,
        route,
        invoiceId,
        expectedVersion,
        reason,
        actorUserId,
        at,
      ),
    );
  }

  issueInvoice(
    context: TrustedTenantContext,
    invoiceId: string,
    expectedVersion: number,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    return this.withRoute(context, (route) =>
      this.storage.issueInvoice(context, route, invoiceId, expectedVersion, actorUserId, at),
    );
  }

  createTransfer(
    context: TrustedTenantContext,
    transfer: ClinicInvoiceTransfer,
  ): Promise<ClinicInvoiceTransfer> {
    return this.withRoute(context, (route) => this.storage.createTransfer(context, route, transfer));
  }

  listTransfers(
    context: TrustedTenantContext,
    filters: { invoiceId?: string; status?: ClinicInvoiceTransferStatus },
  ): Promise<ClinicInvoiceTransfer[]> {
    return this.withRoute(context, (route) => this.storage.listTransfers(context, route, filters));
  }

  findTransfer(
    context: TrustedTenantContext,
    transferId: string,
  ): Promise<ClinicInvoiceTransfer | null> {
    return this.withRoute(context, (route) =>
      this.storage.findTransfer(context, route, transferId),
    );
  }

  reviewTransfer(
    context: TrustedTenantContext,
    transferId: string,
    expectedVersion: number,
    status: 'APPROVED' | 'REJECTED',
    actorUserId: string,
    reason: string,
    at: Date,
  ): Promise<ClinicInvoiceTransfer | null> {
    return this.withRoute(context, (route) =>
      this.storage.reviewTransfer(
        context,
        route,
        transferId,
        expectedVersion,
        status,
        actorUserId,
        reason,
        at,
      ),
    );
  }

  private async withRoute<T>(
    context: TrustedTenantContext,
    operation: (route: Awaited<ReturnType<TenantStorageResolver['resolve']>>) => Promise<T>,
  ): Promise<T> {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    try {
      return await operation(await this.resolver.resolve(context));
    } catch (error) {
      if (
        error instanceof TenantContextInvalidError ||
        error instanceof TenantStorageNotConfiguredError ||
        error instanceof TenantStorageUnavailableError ||
        error instanceof HttpException
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }
  }
}
