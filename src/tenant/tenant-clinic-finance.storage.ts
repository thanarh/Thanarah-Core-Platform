import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ClinicInvoice,
  ClinicInvoiceAuditEvent,
  ClinicInvoiceListResult,
  ClinicInvoiceReviewedPolicy,
  ClinicInvoiceSettings,
  ClinicInvoiceSettingsRevision,
  ClinicInvoiceTotals,
} from './clinic-finance.model';
import type {
  ListClinicInvoicesQuery,
  UpdateClinicFinanceSettingsInput,
  UpdateClinicInvoiceInput,
} from './clinic-finance.dto';
import {
  ClinicFinanceAuditCapacityError,
  ClinicInvoiceNumberConflictError,
} from './clinic-finance.errors';
import {
  TenantContextInvalidError,
  isWellFormedTrustedTenantContext,
} from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import type { TenantStorageRoute } from './tenant-storage.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from './tenant-storage.errors';
import { DEFAULT_CLINIC_INVOICE_SETTINGS } from './clinic-finance.model';

export const CLINIC_FINANCE_STORAGE = Symbol('CLINIC_FINANCE_STORAGE');

export type ClinicInvoiceCreateResult =
  | { kind: 'created'; invoice: ClinicInvoice }
  | { kind: 'existing'; invoice: ClinicInvoice }
  | { kind: 'idempotency-conflict' };

export interface ClinicFinanceStorage {
  getSettings(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<ClinicInvoiceSettings>;
  saveSettings(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: UpdateClinicFinanceSettingsInput,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoiceSettings | null>;
  createInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoice: ClinicInvoice,
  ): Promise<ClinicInvoiceCreateResult>;
  listInvoices(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    query: ListClinicInvoicesQuery,
  ): Promise<ClinicInvoiceListResult>;
  findInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
  ): Promise<ClinicInvoice | null>;
  updateDraft(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    patch: UpdateClinicInvoiceInput,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null>;
  reviewInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    reviewedPolicy: ClinicInvoiceReviewedPolicy,
    totals: ClinicInvoiceTotals,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null>;
  returnToDraft(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    reason: string,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null>;
  issueInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null>;
}

@Injectable()
export class InMemoryClinicFinanceStorage implements ClinicFinanceStorage {
  private readonly settingsByTenant = new Map<string, ClinicInvoiceSettings>();
  private readonly invoicesByTenant = new Map<string, Map<string, ClinicInvoice>>();

  async getSettings(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<ClinicInvoiceSettings> {
    this.assertScope(context, route);
    return clone(this.settingsByTenant.get(keyFor(context)) ?? this.defaultSettings(context));
  }

  async saveSettings(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: UpdateClinicFinanceSettingsInput,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoiceSettings | null> {
    this.assertScope(context, route);
    const current = this.settingsByTenant.get(keyFor(context)) ?? this.defaultSettings(context);
    if (current.version !== input.expectedVersion) return null;
    if (current.revisions.length >= 1_000) throw new ClinicFinanceAuditCapacityError();
    const nextVersion = current.version + 1;
    const nextSequence =
      input.numberingPolicy?.mode !== 'SEQUENTIAL'
        ? current.nextSequence
        : (current.nextSequence ?? input.numberingPolicy.startingNumber);
    const settings: ClinicInvoiceSettings = {
      tenantId: context.tenantId,
      version: nextVersion,
      currencyCode: input.currencyCode,
      lineRounding: input.lineRounding,
      customFields: clone(input.customFields),
      taxPolicies: clone(input.taxPolicies),
      numberingPolicy: clone(input.numberingPolicy),
      nextSequence,
      updatedAt: new Date(at),
      updatedBy: actorUserId,
      revisions: [
        ...current.revisions,
        createSettingsRevision(nextVersion, actorUserId, at, {
          currencyCode: input.currencyCode,
          lineRounding: input.lineRounding,
          customFields: input.customFields,
          taxPolicies: input.taxPolicies,
          numberingPolicy: input.numberingPolicy,
          nextSequence,
        }),
      ],
    };
    this.settingsByTenant.set(keyFor(context), settings);
    return clone(settings);
  }

  async createInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoice: ClinicInvoice,
  ): Promise<ClinicInvoiceCreateResult> {
    this.assertScope(context, route);
    const invoices = this.partition(context);
    if (invoice.creationKeyHash) {
      const existing = [...invoices.values()].find(
        (candidate) =>
          candidate.createdBy === invoice.createdBy &&
          candidate.creationKeyHash === invoice.creationKeyHash,
      );
      if (existing) {
        if (existing.creationFingerprint !== invoice.creationFingerprint) {
          return { kind: 'idempotency-conflict' };
        }
        return { kind: 'existing', invoice: clone(existing) };
      }
    }
    invoices.set(invoice.id, clone(invoice));
    return { kind: 'created', invoice: clone(invoice) };
  }

  async listInvoices(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    query: ListClinicInvoicesQuery,
  ): Promise<ClinicInvoiceListResult> {
    this.assertScope(context, route);
    const search = query.search?.toLocaleLowerCase();
    const filtered = [...this.partition(context).values()]
      .filter((invoice) => !query.status || invoice.status === query.status)
      .filter(
        (invoice) =>
          !search ||
          [invoice.invoiceNumber, invoice.manualInvoiceNumber, invoice.recipientName].some(
            (value) => value?.toLocaleLowerCase().includes(search),
          ),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      );
    const items = filtered
      .slice(query.offset, query.offset + query.limit)
      .map((invoice) => clone(invoice));
    return {
      items,
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
      hasNext: query.offset + items.length < filtered.length,
    };
  }

  async findInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
  ): Promise<ClinicInvoice | null> {
    this.assertScope(context, route);
    const invoice = this.partition(context).get(invoiceId);
    return invoice ? clone(invoice) : null;
  }

  async updateDraft(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    patch: UpdateClinicInvoiceInput,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    this.assertScope(context, route);
    const invoices = this.partition(context);
    const current = invoices.get(invoiceId);
    if (!current || current.status !== 'DRAFT' || current.version !== expectedVersion) return null;
    const version = current.version + 1;
    const updated: ClinicInvoice = {
      ...current,
      ...(patch.currencyCode === undefined ? {} : { currencyCode: patch.currencyCode }),
      ...(patch.recipientName === undefined ? {} : { recipientName: patch.recipientName }),
      ...(patch.invoiceDate === undefined ? {} : { invoiceDate: patch.invoiceDate }),
      ...(patch.customFieldValues === undefined
        ? {}
        : { customFieldValues: clone(patch.customFieldValues) }),
      ...(patch.taxPolicyId === undefined ? {} : { taxPolicyId: patch.taxPolicyId }),
      ...(patch.manualInvoiceNumber === undefined
        ? {}
        : { manualInvoiceNumber: patch.manualInvoiceNumber }),
      ...(patch.lines === undefined ? {} : { lines: clone(patch.lines) }),
      version,
      updatedAt: new Date(at),
      updatedBy: actorUserId,
      history: [
        ...current.history,
        auditEvent('UPDATED', actorUserId, at, version, 'Draft updated'),
      ],
    };
    invoices.set(invoiceId, updated);
    return clone(updated);
  }

  async reviewInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    reviewedPolicy: ClinicInvoiceReviewedPolicy,
    totals: ClinicInvoiceTotals,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    this.assertScope(context, route);
    const invoices = this.partition(context);
    const current = invoices.get(invoiceId);
    if (!current || current.status !== 'DRAFT' || current.version !== expectedVersion) return null;
    const version = current.version + 1;
    const reviewed: ClinicInvoice = {
      ...current,
      status: 'REVIEWED',
      totals: clone(totals),
      reviewedPolicy: clone(reviewedPolicy),
      version,
      updatedAt: new Date(at),
      updatedBy: actorUserId,
      reviewedAt: new Date(at),
      reviewedBy: actorUserId,
      history: [
        ...current.history,
        auditEvent('REVIEWED', actorUserId, at, version, 'Invoice reviewed'),
      ],
    };
    invoices.set(invoiceId, reviewed);
    return clone(reviewed);
  }

  async returnToDraft(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    reason: string,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    this.assertScope(context, route);
    const invoices = this.partition(context);
    const current = invoices.get(invoiceId);
    if (!current || current.status !== 'REVIEWED' || current.version !== expectedVersion) {
      return null;
    }
    const version = current.version + 1;
    const updated: ClinicInvoice = {
      ...current,
      status: 'DRAFT',
      invoiceNumber: null,
      totals: null,
      reviewedPolicy: null,
      version,
      updatedAt: new Date(at),
      updatedBy: actorUserId,
      reviewedAt: null,
      reviewedBy: null,
      history: [
        ...current.history,
        auditEvent('RETURNED_TO_DRAFT', actorUserId, at, version, `Returned to draft: ${reason}`),
      ],
    };
    invoices.set(invoiceId, updated);
    return clone(updated);
  }

  async issueInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    this.assertScope(context, route);
    const invoices = this.partition(context);
    const current = invoices.get(invoiceId);
    if (current?.status === 'ISSUED') return clone(current);
    if (
      !current ||
      current.status !== 'REVIEWED' ||
      current.version !== expectedVersion ||
      !current.reviewedPolicy
    ) {
      return null;
    }

    const numberPolicy = current.reviewedPolicy.numberingPolicy;
    const invoiceNumber =
      numberPolicy.mode === 'MANUAL'
        ? current.manualInvoiceNumber
        : formatSequentialNumber(
            numberPolicy.prefix,
            this.reserveSequence(context, current.reviewedPolicy.settingsVersion),
            numberPolicy.minimumDigits,
          );
    if (!invoiceNumber) return null;
    if (
      [...invoices.values()].some(
        (candidate) =>
          candidate.id !== invoiceId &&
          candidate.status === 'ISSUED' &&
          candidate.invoiceNumber === invoiceNumber,
      )
    ) {
      throw new ClinicInvoiceNumberConflictError();
    }
    const version = current.version + 1;
    const issued: ClinicInvoice = {
      ...current,
      invoiceNumber,
      status: 'ISSUED',
      version,
      updatedAt: new Date(at),
      updatedBy: actorUserId,
      issuedAt: new Date(at),
      issuedBy: actorUserId,
      history: [
        ...current.history,
        auditEvent('ISSUED', actorUserId, at, version, 'Invoice issued'),
      ],
    };
    invoices.set(invoiceId, issued);
    return clone(issued);
  }

  private reserveSequence(context: TrustedTenantContext, settingsVersion: number): number {
    const current = this.settingsByTenant.get(keyFor(context));
    if (
      !current ||
      current.version !== settingsVersion ||
      current.numberingPolicy?.mode !== 'SEQUENTIAL' ||
      current.nextSequence === null
    ) {
      throw new TenantStorageUnavailableError();
    }
    const next = current.nextSequence;
    if (!Number.isSafeInteger(next) || next >= Number.MAX_SAFE_INTEGER) {
      throw new TenantStorageUnavailableError();
    }
    this.settingsByTenant.set(keyFor(context), {
      ...current,
      nextSequence: next + 1,
    });
    return next;
  }

  private defaultSettings(context: TrustedTenantContext): ClinicInvoiceSettings {
    return { tenantId: context.tenantId, ...clone(DEFAULT_CLINIC_INVOICE_SETTINGS) };
  }

  private partition(context: TrustedTenantContext): Map<string, ClinicInvoice> {
    const key = keyFor(context);
    let invoices = this.invoicesByTenant.get(key);
    if (!invoices) {
      invoices = new Map();
      this.invoicesByTenant.set(key, invoices);
    }
    return invoices;
  }

  private assertScope(context: TrustedTenantContext, route: TenantStorageRoute): void {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    if (!route || !Array.isArray(route.placements) || route.placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
  }
}

@Injectable()
export class UnconfiguredClinicFinanceStorage implements ClinicFinanceStorage {
  async getSettings(): Promise<ClinicInvoiceSettings> {
    throw new TenantStorageUnavailableError();
  }

  async saveSettings(): Promise<ClinicInvoiceSettings | null> {
    throw new TenantStorageUnavailableError();
  }

  async createInvoice(): Promise<ClinicInvoiceCreateResult> {
    throw new TenantStorageUnavailableError();
  }

  async listInvoices(): Promise<ClinicInvoiceListResult> {
    throw new TenantStorageUnavailableError();
  }

  async findInvoice(): Promise<ClinicInvoice | null> {
    throw new TenantStorageUnavailableError();
  }

  async updateDraft(): Promise<ClinicInvoice | null> {
    throw new TenantStorageUnavailableError();
  }

  async reviewInvoice(): Promise<ClinicInvoice | null> {
    throw new TenantStorageUnavailableError();
  }

  async returnToDraft(): Promise<ClinicInvoice | null> {
    throw new TenantStorageUnavailableError();
  }

  async issueInvoice(): Promise<ClinicInvoice | null> {
    throw new TenantStorageUnavailableError();
  }
}

export function createClinicInvoiceAuditEvent(
  action: ClinicInvoiceAuditEvent['action'],
  actorUserId: string,
  at: Date,
  version: number,
  summary: string,
): ClinicInvoiceAuditEvent {
  return auditEvent(action, actorUserId, at, version, summary);
}

export function createSettingsRevision(
  version: number,
  actorUserId: string,
  at: Date,
  settings: ClinicInvoiceSettingsRevision['settings'],
): ClinicInvoiceSettingsRevision {
  return {
    version,
    changedAt: new Date(at),
    changedBy: actorUserId,
    settings: clone(settings),
  };
}

export function newClinicInvoiceId(): string {
  return randomUUID();
}

function auditEvent(
  action: ClinicInvoiceAuditEvent['action'],
  actorUserId: string,
  at: Date,
  version: number,
  summary: string,
): ClinicInvoiceAuditEvent {
  return {
    id: randomUUID(),
    action,
    actorUserId,
    at: new Date(at),
    version,
    summary: summary.slice(0, 256),
  };
}

function formatSequentialNumber(prefix: string, sequence: number, minimumDigits: number): string {
  return `${prefix}${String(sequence).padStart(minimumDigits, '0')}`;
}

function keyFor(context: TrustedTenantContext): string {
  return context.tenantId.toLowerCase();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
