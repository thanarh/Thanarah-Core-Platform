import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import type {
  ClinicInvoice,
  ClinicInvoicePage,
  ClinicInvoiceReviewedPolicy,
  ClinicInvoiceSettings,
  ClinicInvoiceTotals,
  ClinicInvoiceTransfer,
  ClinicInvoiceTransferStatus,
  ClinicInvoiceTransferView,
} from './clinic-finance.model';
import {
  calculateClinicInvoiceTotals,
  isSupportedCurrencyCode,
} from './clinic-finance.calculation';
import {
  clinicInvoiceIdSchema,
  clinicInvoiceTransferIdSchema,
  clinicInvoiceTransitionSchema,
  createClinicInvoiceSchema,
  listClinicInvoicesQuerySchema,
  returnClinicInvoiceToDraftSchema,
  updateClinicFinanceSettingsSchema,
  updateClinicInvoiceSchema,
} from './clinic-finance.dto';
import type {
  CreateClinicInvoiceInput,
  ListClinicInvoicesQuery,
  UpdateClinicFinanceSettingsInput,
  UpdateClinicInvoiceInput,
} from './clinic-finance.dto';
import {
  ClinicFinanceInputError,
  ClinicFinanceSettingsConflictError,
  ClinicInvoiceIdempotencyConflictError,
  ClinicInvoiceNotFoundError,
  ClinicInvoicePaymentUnavailableError,
  ClinicInvoicePolicyUnavailableError,
  ClinicInvoiceStateConflictError,
  ClinicInvoiceTransferNotFoundError,
} from './clinic-finance.errors';
import { ClinicFinanceRepository } from './clinic-finance.repository';
import { createClinicInvoiceAuditEvent, newClinicInvoiceId } from './tenant-clinic-finance.storage';
import type { ReceiptUpload } from '../common/receipt-upload';

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/u;
const MAX_INVOICE_HISTORY = 1_000;

export interface ClinicFinanceRequestContext {
  requestId?: string;
}

@Injectable()
export class ClinicFinanceService {
  constructor(
    @Inject(ClinicFinanceRepository) private readonly repository: ClinicFinanceRepository,
  ) {}

  async getSettings(context: Parameters<ClinicFinanceRepository['getSettings']>[0]) {
    return presentSettings(await this.repository.getSettings(context));
  }

  async updateSettings(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    input: UpdateClinicFinanceSettingsInput,
    actor: AuthenticatedPlatformUser,
  ) {
    this.assertActor(context, actor);
    const parsed = updateClinicFinanceSettingsSchema.safeParse(input);
    if (!parsed.success) throw new ClinicFinanceInputError();
    validateSettings(parsed.data);
    const settings = await this.repository.saveSettings(
      context,
      parsed.data,
      actor.userId,
      new Date(),
    );
    if (!settings) throw new ClinicFinanceSettingsConflictError();
    return presentSettings(settings);
  }

  async listInvoices(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    query: ListClinicInvoicesQuery,
  ): Promise<ClinicInvoicePage> {
    const parsed = listClinicInvoicesQuerySchema.safeParse(query);
    if (!parsed.success) throw new ClinicFinanceInputError();
    const result = await this.repository.listInvoices(context, parsed.data);
    return { ...result, items: result.items.map(presentInvoice) };
  }

  async getInvoice(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    invoiceId: string,
  ) {
    const parsedId = clinicInvoiceIdSchema.safeParse(invoiceId);
    if (!parsedId.success) throw new ClinicFinanceInputError();
    const invoice = await this.repository.findInvoice(context, parsedId.data);
    if (!invoice) throw new ClinicInvoiceNotFoundError();
    return presentInvoice(invoice);
  }

  async createInvoice(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    input: CreateClinicInvoiceInput,
    actor: AuthenticatedPlatformUser,
    idempotencyKey?: string,
  ) {
    this.assertActor(context, actor);
    const parsed = createClinicInvoiceSchema.safeParse(input);
    if (!parsed.success || (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))) {
      throw new ClinicFinanceInputError();
    }
    const settings = await this.repository.getSettings(context);
    validateInvoiceContents(parsed.data, settings, false);
    const now = new Date();
    const id = newClinicInvoiceId();
    const creationKeyHash = idempotencyKey
      ? createHash('sha256').update(`${actor.userId}:${idempotencyKey}`).digest('hex')
      : null;
    const creationFingerprint = idempotencyKey ? fingerprint(parsed.data) : null;
    const invoice: ClinicInvoice = {
      id,
      tenantId: context.tenantId,
      invoiceNumber: null,
      manualInvoiceNumber: parsed.data.manualInvoiceNumber ?? null,
      status: 'DRAFT',
      recipientName: parsed.data.recipientName,
      invoiceDate: parsed.data.invoiceDate,
      customFieldValues: parsed.data.customFieldValues,
      taxPolicyId: parsed.data.taxPolicyId ?? null,
      currencyCode: settings.currencyCode,
      lines: parsed.data.lines,
      totals: null,
      reviewedPolicy: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.userId,
      updatedBy: actor.userId,
      reviewedAt: null,
      reviewedBy: null,
      issuedAt: null,
      issuedBy: null,
      creationKeyHash,
      creationFingerprint,
      history: [createClinicInvoiceAuditEvent('CREATED', actor.userId, now, 1, 'Draft created')],
    };
    const result = await this.repository.createInvoice(context, invoice);
    if (result.kind === 'idempotency-conflict') {
      throw new ClinicInvoiceIdempotencyConflictError();
    }
    return presentInvoice(result.invoice);
  }

  async updateInvoice(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    invoiceId: string,
    input: UpdateClinicInvoiceInput,
    actor: AuthenticatedPlatformUser,
  ) {
    this.assertActor(context, actor);
    const id = clinicInvoiceIdSchema.safeParse(invoiceId);
    const parsed = updateClinicInvoiceSchema.safeParse(input);
    if (!id.success || !parsed.success) throw new ClinicFinanceInputError();
    const current = await this.requireInvoice(context, id.data);
    if (current.status !== 'DRAFT' || current.version !== parsed.data.expectedVersion) {
      throw new ClinicInvoiceStateConflictError();
    }
    const settings = await this.repository.getSettings(context);
    const nextCurrency = parsed.data.currencyCode ?? current.currencyCode;
    if (
      nextCurrency !== settings.currencyCode ||
      (nextCurrency !== current.currencyCode && !parsed.data.lines)
    ) {
      throw new ClinicFinanceInputError();
    }
    validateInvoicePatch(parsed.data, settings);
    const updated = await this.repository.updateDraft(
      context,
      id.data,
      parsed.data.expectedVersion,
      parsed.data,
      actor.userId,
      new Date(),
    );
    if (!updated) throw new ClinicInvoiceStateConflictError();
    return presentInvoice(updated);
  }

  async reviewInvoice(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    invoiceId: string,
    input: { expectedVersion: number },
    actor: AuthenticatedPlatformUser,
  ) {
    this.assertActor(context, actor);
    const id = clinicInvoiceIdSchema.safeParse(invoiceId);
    const parsed = clinicInvoiceTransitionSchema.safeParse(input);
    if (!id.success || !parsed.success) throw new ClinicFinanceInputError();
    const invoice = await this.requireInvoice(context, id.data);
    if (invoice.status !== 'DRAFT' || invoice.version !== parsed.data.expectedVersion) {
      throw new ClinicInvoiceStateConflictError();
    }
    const settings = await this.repository.getSettings(context);
    const policy = buildReviewedPolicy(invoice, settings);
    const totals = calculateTotals(invoice, policy);
    const reviewed = await this.repository.reviewInvoice(
      context,
      invoice.id,
      invoice.version,
      policy,
      totals,
      actor.userId,
      new Date(),
    );
    if (!reviewed) throw new ClinicInvoiceStateConflictError();
    return presentInvoice(reviewed);
  }

  async returnToDraft(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    invoiceId: string,
    input: { expectedVersion: number; reason: string },
    actor: AuthenticatedPlatformUser,
  ) {
    this.assertActor(context, actor);
    const id = clinicInvoiceIdSchema.safeParse(invoiceId);
    const parsed = returnClinicInvoiceToDraftSchema.safeParse(input);
    if (!id.success || !parsed.success) throw new ClinicFinanceInputError();
    const returned = await this.repository.returnToDraft(
      context,
      id.data,
      parsed.data.expectedVersion,
      parsed.data.reason,
      actor.userId,
      new Date(),
    );
    if (!returned) throw new ClinicInvoiceStateConflictError();
    return presentInvoice(returned);
  }

  async issueInvoice(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    invoiceId: string,
    input: { expectedVersion: number },
    actor: AuthenticatedPlatformUser,
  ) {
    this.assertActor(context, actor);
    const id = clinicInvoiceIdSchema.safeParse(invoiceId);
    const parsed = clinicInvoiceTransitionSchema.safeParse(input);
    if (!id.success || !parsed.success) throw new ClinicFinanceInputError();
    const current = await this.requireInvoice(context, id.data);
    if (current.status === 'ISSUED') return presentInvoice(current);
    if (
      current.status !== 'REVIEWED' ||
      current.version !== parsed.data.expectedVersion ||
      !current.reviewedPolicy
    ) {
      throw new ClinicInvoiceStateConflictError();
    }
    const settings = await this.repository.getSettings(context);
    if (current.reviewedPolicy.settingsVersion !== settings.version) {
      throw new ClinicInvoiceStateConflictError();
    }
    const issued = await this.repository.issueInvoice(
      context,
      id.data,
      parsed.data.expectedVersion,
      actor.userId,
      new Date(),
    );
    if (!issued) throw new ClinicInvoiceStateConflictError();
    return presentInvoice(issued);
  }

  async submitInvoiceTransfer(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    invoiceId: string,
    receipt: ReceiptUpload,
    actor: AuthenticatedPlatformUser,
    idempotencyKey?: string,
  ): Promise<ClinicInvoiceTransferView> {
    this.assertActor(context, actor);
    const id = clinicInvoiceIdSchema.safeParse(invoiceId);
    if (!id.success || (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))) {
      throw new ClinicFinanceInputError();
    }
    const settings = await this.repository.getSettings(context);
    const invoice = await this.requireInvoice(context, id.data);
    if (
      !settings.bankTransfer.enabled ||
      !settings.bankTransfer.bankName ||
      !settings.bankTransfer.accountHolder ||
      !settings.bankTransfer.iban ||
      !settings.bankTransfer.currencyCode ||
      !isSupportedCurrencyCode(settings.bankTransfer.currencyCode) ||
      invoice.status !== 'ISSUED' ||
      !invoice.totals ||
      settings.bankTransfer.currencyCode !== invoice.currencyCode
    ) {
      throw new ClinicInvoicePaymentUnavailableError();
    }
    const keyHash = idempotencyKey
      ? createHash('sha256').update(`${actor.userId}:${idempotencyKey}`).digest('hex')
      : null;
    const existing = await this.repository.listTransfers(context, { invoiceId: id.data });
    const retry = existing.find(
      (candidate) =>
        keyHash &&
        candidate.idempotencyKeyHash === keyHash &&
        candidate.submittedBy === actor.userId,
    );
    if (retry) {
      if (retry.receiptSha256 !== receipt.sha256) {
        throw new ClinicInvoiceStateConflictError();
      }
      return presentTransfer(retry);
    }
    if (existing.some(({ status }) => status === 'PENDING_REVIEW' || status === 'APPROVED')) {
      throw new ClinicInvoiceStateConflictError();
    }
    const now = new Date();
    const transfer: ClinicInvoiceTransfer = {
      id: newClinicInvoiceId(),
      tenantId: context.tenantId,
      invoiceId: invoice.id,
      status: 'PENDING_REVIEW',
      amountMinor: invoice.totals.totalMinor,
      currencyCode: invoice.currencyCode,
      receiptFileName: receipt.fileName,
      receiptMimeType: receipt.mimeType,
      receiptSha256: receipt.sha256,
      receiptBytes: Buffer.from(receipt.bytes),
      submittedBy: actor.userId,
      submittedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
      version: 1,
      history: [{ action: 'SUBMITTED', actorUserId: actor.userId, at: now, reason: null }],
      idempotencyKeyHash: keyHash,
    };
    const saved = await this.repository.createTransfer(context, transfer);
    if (saved.id !== transfer.id) {
      if (!keyHash || saved.idempotencyKeyHash !== keyHash || saved.receiptSha256 !== receipt.sha256) {
        throw new ClinicInvoiceStateConflictError();
      }
    }
    return presentTransfer(saved);
  }

  async listInvoiceTransfers(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    filters: { invoiceId?: string; status?: ClinicInvoiceTransferStatus },
  ): Promise<ClinicInvoiceTransferView[]> {
    if (filters.invoiceId && !clinicInvoiceIdSchema.safeParse(filters.invoiceId).success) {
      throw new ClinicFinanceInputError();
    }
    if (filters.invoiceId && !(await this.repository.findInvoice(context, filters.invoiceId))) {
      throw new ClinicInvoiceNotFoundError();
    }
    return (await this.repository.listTransfers(context, filters)).map(presentTransfer);
  }

  async getTransferReceipt(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    transferId: string,
  ): Promise<ClinicInvoiceTransfer> {
    if (!clinicInvoiceTransferIdSchema.safeParse(transferId).success) {
      throw new ClinicFinanceInputError();
    }
    const transfer = await this.repository.findTransfer(context, transferId);
    if (!transfer) throw new ClinicInvoiceTransferNotFoundError();
    return transfer;
  }

  async reviewInvoiceTransfer(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    transferId: string,
    input: { expectedVersion: number; reason: string },
    status: 'APPROVED' | 'REJECTED',
    actor: AuthenticatedPlatformUser,
  ): Promise<ClinicInvoiceTransferView> {
    this.assertActor(context, actor);
    const parsedId = clinicInvoiceTransferIdSchema.safeParse(transferId);
    if (
      !parsedId.success ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      typeof input.reason !== 'string' ||
      input.reason.trim().length < 3 ||
      input.reason.trim().length > 500
    ) {
      throw new ClinicFinanceInputError();
    }
    const updated = await this.repository.reviewTransfer(
      context,
      parsedId.data,
      input.expectedVersion,
      status,
      actor.userId,
      input.reason.trim(),
      new Date(),
    );
    if (!updated) {
      if (!(await this.repository.findTransfer(context, parsedId.data))) {
        throw new ClinicInvoiceTransferNotFoundError();
      }
      throw new ClinicInvoiceStateConflictError();
    }
    return presentTransfer(updated);
  }

  private async requireInvoice(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    invoiceId: string,
  ): Promise<ClinicInvoice> {
    const invoice = await this.repository.findInvoice(context, invoiceId);
    if (!invoice) throw new ClinicInvoiceNotFoundError();
    if (invoice.history.length >= MAX_INVOICE_HISTORY) {
      throw new ClinicInvoiceStateConflictError();
    }
    return invoice;
  }

  private assertActor(
    context: Parameters<ClinicFinanceRepository['getSettings']>[0],
    actor: AuthenticatedPlatformUser,
  ): void {
    if (!actor?.userId || actor.userId !== context.platformUserId) {
      throw new ClinicFinanceInputError();
    }
  }
}

function validateSettings(input: UpdateClinicFinanceSettingsInput): void {
  if (new Set(input.customFields.map(({ key }) => key)).size !== input.customFields.length) {
    throw new ClinicFinanceInputError();
  }
  if (new Set(input.taxPolicies.map(({ id }) => id)).size !== input.taxPolicies.length) {
    throw new ClinicFinanceInputError();
  }
  if (input.numberingPolicy && !isSafePrefix(input.numberingPolicy.prefix)) {
    throw new ClinicFinanceInputError();
  }
  if (
    input.bankTransfer?.enabled &&
    (!input.bankTransfer.bankName ||
      !input.bankTransfer.accountHolder ||
      !input.bankTransfer.iban ||
      !input.bankTransfer.currencyCode)
  ) {
    throw new ClinicFinanceInputError();
  }
}

function validateInvoiceContents(
  input: CreateClinicInvoiceInput,
  settings: ClinicInvoiceSettings,
  reviewing: boolean,
): void {
  if (new Set(input.lines.map(({ id }) => id)).size !== input.lines.length) {
    throw new ClinicFinanceInputError();
  }
  validateCustomFieldValues(input.customFieldValues, settings.customFields);
  if (input.taxPolicyId && !settings.taxPolicies.some(({ id }) => id === input.taxPolicyId)) {
    throw new ClinicFinanceInputError();
  }
  if (input.manualInvoiceNumber && !isValidManualNumber(input.manualInvoiceNumber)) {
    throw new ClinicFinanceInputError();
  }
  if (reviewing && settings.numberingPolicy?.mode === 'MANUAL' && !input.manualInvoiceNumber) {
    throw new ClinicInvoicePolicyUnavailableError();
  }
}

function validateInvoicePatch(
  input: UpdateClinicInvoiceInput,
  settings: ClinicInvoiceSettings,
): void {
  if (input.customFieldValues !== undefined) {
    validateCustomFieldValues(input.customFieldValues, settings.customFields);
  }
  if (input.taxPolicyId && !settings.taxPolicies.some(({ id }) => id === input.taxPolicyId)) {
    throw new ClinicFinanceInputError();
  }
  if (input.manualInvoiceNumber && !isValidManualNumber(input.manualInvoiceNumber)) {
    throw new ClinicFinanceInputError();
  }
  if (input.lines && new Set(input.lines.map(({ id }) => id)).size !== input.lines.length) {
    throw new ClinicFinanceInputError();
  }
}

function validateCustomFieldValues(
  values: Record<string, string | boolean>,
  fields: ClinicInvoiceSettings['customFields'],
): void {
  const definitions = new Map(fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(values)) {
    const definition = definitions.get(key);
    if (!definition) throw new ClinicFinanceInputError();
    if (
      (definition.type === 'BOOLEAN' && typeof value !== 'boolean') ||
      (definition.type !== 'BOOLEAN' && typeof value !== 'string') ||
      (definition.type === 'DATE' && typeof value === 'string' && !isDateOnly(value))
    ) {
      throw new ClinicFinanceInputError();
    }
  }
}

function buildReviewedPolicy(
  invoice: ClinicInvoice,
  settings: ClinicInvoiceSettings,
): ClinicInvoiceReviewedPolicy {
  if (
    !settings.version ||
    !settings.lineRounding ||
    !settings.numberingPolicy ||
    invoice.currencyCode !== settings.currencyCode ||
    !invoice.taxPolicyId
  ) {
    throw new ClinicInvoicePolicyUnavailableError();
  }
  const taxPolicy = settings.taxPolicies.find(({ id }) => id === invoice.taxPolicyId);
  if (!taxPolicy) throw new ClinicInvoicePolicyUnavailableError();
  validateInvoiceContents(
    {
      recipientName: invoice.recipientName,
      invoiceDate: invoice.invoiceDate,
      customFieldValues: invoice.customFieldValues,
      taxPolicyId: invoice.taxPolicyId,
      manualInvoiceNumber: invoice.manualInvoiceNumber,
      lines: invoice.lines,
    },
    settings,
    false,
  );
  for (const field of settings.customFields) {
    const value = invoice.customFieldValues[field.key];
    if (field.required && (value === undefined || value === '')) {
      throw new ClinicInvoicePolicyUnavailableError();
    }
  }
  if (settings.numberingPolicy.mode === 'MANUAL') {
    if (
      !invoice.manualInvoiceNumber ||
      (settings.numberingPolicy.prefix &&
        !invoice.manualInvoiceNumber.startsWith(settings.numberingPolicy.prefix))
    ) {
      throw new ClinicInvoicePolicyUnavailableError();
    }
  } else if (invoice.manualInvoiceNumber || settings.nextSequence === null) {
    throw new ClinicInvoicePolicyUnavailableError();
  }
  return {
    settingsVersion: settings.version,
    currencyCode: settings.currencyCode,
    lineRounding: settings.lineRounding,
    taxPolicy,
    numberingPolicy: settings.numberingPolicy,
  };
}

function calculateTotals(
  invoice: ClinicInvoice,
  policy: ClinicInvoiceReviewedPolicy,
): ClinicInvoiceTotals {
  try {
    return calculateClinicInvoiceTotals(invoice.lines, policy.taxPolicy, policy.lineRounding);
  } catch {
    throw new ClinicFinanceInputError();
  }
}

function isSafePrefix(value: string): boolean {
  return !/[\u0000-\u001f\u007f]/u.test(value);
}

function isValidManualNumber(value: string): boolean {
  return value.length <= 64 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function fingerprint(input: CreateClinicInvoiceInput): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function presentSettings(settings: ClinicInvoiceSettings) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'tenantId')) as Omit<
    ClinicInvoiceSettings,
    'tenantId'
  >;
}

function presentInvoice(invoice: ClinicInvoice) {
  const privateFields = new Set([
    'tenantId',
    'creationKeyHash',
    'creationFingerprint',
    'createdBy',
    'updatedBy',
    'reviewedBy',
    'issuedBy',
  ]);
  return Object.fromEntries(
    Object.entries(invoice).filter(([key]) => !privateFields.has(key)),
  ) as Omit<
    ClinicInvoice,
    | 'tenantId'
    | 'creationKeyHash'
    | 'creationFingerprint'
    | 'createdBy'
    | 'updatedBy'
    | 'reviewedBy'
    | 'issuedBy'
  >;
}

function presentTransfer(transfer: ClinicInvoiceTransfer): ClinicInvoiceTransferView {
  const { tenantId: _tenantId, receiptBytes: _receiptBytes, idempotencyKeyHash: _key, ...view } =
    transfer;
  return view;
}
