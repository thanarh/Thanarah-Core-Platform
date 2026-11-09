import { Inject, Injectable } from '@nestjs/common';
import type {
  Collection,
  Db,
  Document,
  Filter,
  IndexDescription,
  IndexSpecification,
} from 'mongodb';
import type {
  ClinicInvoice,
  ClinicInvoiceAuditEvent,
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
  ClinicFinanceAuditCapacityError,
  ClinicInvoiceIdempotencyConflictError,
  ClinicInvoiceNumberConflictError,
  ClinicInvoiceStateConflictError,
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
import { TenantMongoClientManager } from './tenant-mongo-client.manager';
import { TENANT_STORAGE_TARGET_RESOLVER } from './tenant-storage.registry';
import type {
  TenantStorageTargetRecord,
  TenantStorageTargetResolver,
} from './tenant-storage.registry';
import { formatClinicInvoiceNumber } from './clinic-finance.calculation';
import {
  createClinicInvoiceAuditEvent,
  createSettingsRevision,
  type ClinicFinanceStorage,
  type ClinicInvoiceCreateResult,
} from './tenant-clinic-finance.storage';
import { DEFAULT_CLINIC_INVOICE_SETTINGS } from './clinic-finance.model';

const SETTINGS_COLLECTION_NAME = 'clinic_finance_settings';
const INVOICE_COLLECTION_NAME = 'clinic_invoices';
const TRANSFER_COLLECTION_NAME = 'clinic_invoice_transfers';
const SETTINGS_UNIQUE_INDEX = {
  name: 'clinic_finance_settings_tenant_unique',
  key: { _tenantId: 1 },
} satisfies { name: string; key: IndexSpecification };
const INVOICE_INDEXES: ReadonlyArray<{
  name: string;
  key: IndexSpecification;
  unique?: boolean;
  partialFilterExpression?: Document;
}> = [
  {
    name: 'clinic_invoice_status_created_idx',
    key: { _tenantId: 1, status: 1, createdAt: -1, _id: -1 },
  },
  {
    name: 'clinic_invoice_number_unique',
    key: { _tenantId: 1, invoiceNumber: 1 },
    unique: true,
    partialFilterExpression: { invoiceNumber: { $type: 'string' } },
  },
  {
    name: 'clinic_invoice_creation_key_unique',
    key: { _tenantId: 1, createdBy: 1, creationKeyHash: 1 },
    unique: true,
    partialFilterExpression: { creationKeyHash: { $type: 'string' } },
  },
];
const TRANSFER_INDEXES: ReadonlyArray<{
  name: string;
  key: IndexSpecification;
  unique?: boolean;
  partialFilterExpression?: Document;
}> = [
  {
    name: 'clinic_invoice_transfer_status_submitted_idx',
    key: { _tenantId: 1, status: 1, submittedAt: -1, _id: -1 },
  },
  {
    name: 'clinic_invoice_transfer_pending_unique',
    key: { _tenantId: 1, invoiceId: 1 },
    unique: true,
    partialFilterExpression: { status: 'PENDING_REVIEW' },
  },
  {
    name: 'clinic_invoice_transfer_approved_unique',
    key: { _tenantId: 1, invoiceId: 1 },
    unique: true,
    partialFilterExpression: { status: 'APPROVED' },
  },
  {
    name: 'clinic_invoice_transfer_idempotency_unique',
    key: { _tenantId: 1, invoiceId: 1, submittedBy: 1, idempotencyKeyHash: 1 },
    unique: true,
    partialFilterExpression: { idempotencyKeyHash: { $type: 'string' } },
  },
];
const MAX_AUDIT_EVENTS = 1_000;
const MAX_SETTINGS_REVISIONS = 1_000;
const MAX_TRANSFER_HISTORY = 100;

interface PendingIssue {
  invoiceId: string;
  invoiceNumber: string;
  actorUserId: string;
  at: Date;
  expectedVersion: number;
}

interface ClinicInvoiceSettingsDocument extends Document, Omit<ClinicInvoiceSettings, 'tenantId'> {
  _id: string;
  _tenantId: string;
  pendingIssue: PendingIssue | null;
}

interface ClinicInvoiceDocument extends Document, Omit<ClinicInvoice, 'id' | 'tenantId'> {
  _id: string;
  _tenantId: string;
}

interface ClinicInvoiceTransferDocument
  extends Document,
    Omit<ClinicInvoiceTransfer, 'id' | 'tenantId'> {
  _id: string;
  _tenantId: string;
}

@Injectable()
export class MongoTenantClinicFinanceStorage implements ClinicFinanceStorage {
  constructor(
    @Inject(TENANT_STORAGE_TARGET_RESOLVER)
    private readonly targetResolver: TenantStorageTargetResolver,
    private readonly clients: TenantMongoClientManager,
  ) {}

  async getSettings(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<ClinicInvoiceSettings> {
    const collection = await this.getSettingsCollection(context, route);
    await this.assertSettingsIndex(collection);
    try {
      const document = await collection.findOne({ _tenantId: context.tenantId });
      return document
        ? toSettings(document)
        : {
            tenantId: context.tenantId,
            ...structuredClone(DEFAULT_CLINIC_INVOICE_SETTINGS),
          };
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async saveSettings(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    input: UpdateClinicFinanceSettingsInput,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoiceSettings | null> {
    const collection = await this.getSettingsCollection(context, route);
    await this.assertSettingsIndex(collection);
    try {
      const currentDocument = await collection.findOne({ _tenantId: context.tenantId });
      const current = currentDocument
        ? toSettings(currentDocument)
        : {
            tenantId: context.tenantId,
            ...structuredClone(DEFAULT_CLINIC_INVOICE_SETTINGS),
          };
      if (current.version !== input.expectedVersion) return null;
      if (currentDocument?.pendingIssue) return null;
      if (current.revisions.length >= MAX_SETTINGS_REVISIONS) {
        throw new ClinicFinanceAuditCapacityError();
      }

      const nextSequence =
        input.numberingPolicy?.mode !== 'SEQUENTIAL'
          ? current.nextSequence
          : (current.nextSequence ?? input.numberingPolicy.startingNumber);
      const version = current.version + 1;
      const settingsSnapshot = {
        currencyCode: input.currencyCode,
        lineRounding: input.lineRounding,
        customFields: structuredClone(input.customFields),
        taxPolicies: structuredClone(input.taxPolicies),
        numberingPolicy: structuredClone(input.numberingPolicy),
        bankTransfer: structuredClone(input.bankTransfer ?? current.bankTransfer),
        nextSequence,
      };
      const revision = createSettingsRevision(version, actorUserId, at, settingsSnapshot);
      if (!currentDocument) {
        const document: ClinicInvoiceSettingsDocument = {
          _id: context.tenantId,
          _tenantId: context.tenantId,
          ...settingsSnapshot,
          version,
          updatedAt: new Date(at),
          updatedBy: actorUserId,
          revisions: [revision],
          pendingIssue: null,
        };
        try {
          await collection.insertOne(document);
          return toSettings(document);
        } catch (error) {
          if (isDuplicateKeyError(error)) return null;
          throw error;
        }
      }

      const result = await collection.updateOne(
        {
          _tenantId: context.tenantId,
          version: input.expectedVersion,
          pendingIssue: null,
        },
        {
          $set: {
            ...settingsSnapshot,
            version,
            updatedAt: new Date(at),
            updatedBy: actorUserId,
          },
          $push: { revisions: revision },
        } as Document,
      );
      if (result.matchedCount === 0) return null;
      const updated = await collection.findOne({ _tenantId: context.tenantId });
      return updated ? toSettings(updated) : null;
    } catch (error) {
      if (error instanceof ClinicFinanceAuditCapacityError) throw error;
      throw new TenantStorageUnavailableError();
    }
  }

  async createInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoice: ClinicInvoice,
  ): Promise<ClinicInvoiceCreateResult> {
    const collection = await this.getInvoiceCollection(context, route);
    await this.assertInvoiceIndexes(collection);
    const document = toInvoiceDocument(context.tenantId, invoice);
    try {
      await collection.insertOne(document);
      return { kind: 'created', invoice: toInvoice(document) };
    } catch (error) {
      if (isDuplicateKeyError(error) && invoice.creationKeyHash) {
        const existing = await collection.findOne({
          _tenantId: context.tenantId,
          createdBy: invoice.createdBy,
          creationKeyHash: invoice.creationKeyHash,
        });
        if (!existing) throw new ClinicInvoiceNumberConflictError();
        if (existing.creationFingerprint !== invoice.creationFingerprint) {
          throw new ClinicInvoiceIdempotencyConflictError();
        }
        return { kind: 'existing', invoice: toInvoice(existing) };
      }
      if (isDuplicateKeyError(error)) throw new ClinicInvoiceNumberConflictError();
      throw new TenantStorageUnavailableError();
    }
  }

  async listInvoices(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    query: ListClinicInvoicesQuery,
  ): Promise<ClinicInvoiceListResult> {
    const collection = await this.getInvoiceCollection(context, route);
    const search = query.search ? new RegExp(escapeRegex(query.search), 'i') : undefined;
    const filter: Filter<ClinicInvoiceDocument> = {
      _tenantId: context.tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            $or: [
              { recipientName: search },
              { invoiceNumber: search },
              { manualInvoiceNumber: search },
            ],
          }
        : {}),
    };
    try {
      const [documents, total] = await Promise.all([
        collection
          .find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(query.offset)
          .limit(query.limit)
          .toArray(),
        collection.countDocuments(filter),
      ]);
      const items = documents.map(toInvoice);
      return {
        items,
        total,
        limit: query.limit,
        offset: query.offset,
        hasNext: query.offset + items.length < total,
      };
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async findInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
  ): Promise<ClinicInvoice | null> {
    const collection = await this.getInvoiceCollection(context, route);
    try {
      const document = await collection.findOne({ _id: invoiceId, _tenantId: context.tenantId });
      return document ? toInvoice(document) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
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
    const collection = await this.getInvoiceCollection(context, route);
    await this.assertInvoiceIndexes(collection);
    const current = await this.findForMutation(collection, context.tenantId, invoiceId);
    if (!current || current.status !== 'DRAFT' || current.version !== expectedVersion) return null;
    if (current.history.length >= MAX_AUDIT_EVENTS) throw new ClinicFinanceAuditCapacityError();
    const version = current.version + 1;
    const update = withoutUndefined({
      currencyCode: patch.currencyCode,
      recipientName: patch.recipientName,
      invoiceDate: patch.invoiceDate,
      customFieldValues: patch.customFieldValues,
      taxPolicyId: patch.taxPolicyId,
      manualInvoiceNumber: patch.manualInvoiceNumber,
      lines: patch.lines,
    });
    return this.updateInvoiceWithHistory(
      collection,
      context.tenantId,
      invoiceId,
      expectedVersion,
      { ...update, version, updatedAt: new Date(at), updatedBy: actorUserId },
      createClinicInvoiceAuditEvent('UPDATED', actorUserId, at, version, 'Draft updated'),
    );
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
    const collection = await this.getInvoiceCollection(context, route);
    await this.assertInvoiceIndexes(collection);
    const current = await this.findForMutation(collection, context.tenantId, invoiceId);
    if (!current || current.status !== 'DRAFT' || current.version !== expectedVersion) return null;
    if (current.history.length >= MAX_AUDIT_EVENTS) throw new ClinicFinanceAuditCapacityError();
    const version = current.version + 1;
    return this.updateInvoiceWithHistory(
      collection,
      context.tenantId,
      invoiceId,
      expectedVersion,
      {
        status: 'REVIEWED',
        totals,
        reviewedPolicy,
        version,
        updatedAt: new Date(at),
        updatedBy: actorUserId,
        reviewedAt: new Date(at),
        reviewedBy: actorUserId,
      },
      createClinicInvoiceAuditEvent('REVIEWED', actorUserId, at, version, 'Invoice reviewed'),
    );
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
    const settingsCollection = await this.getSettingsCollection(context, route);
    await this.assertSettingsIndex(settingsCollection);
    const invoiceCollection = await this.getInvoiceCollection(context, route);
    await this.assertInvoiceIndexes(invoiceCollection);
    const settings = await settingsCollection.findOne({ _tenantId: context.tenantId });
    if (settings?.pendingIssue?.invoiceId === invoiceId) {
      throw new ClinicInvoiceStateConflictError();
    }
    const current = await this.findForMutation(invoiceCollection, context.tenantId, invoiceId);
    if (!current || current.status !== 'REVIEWED' || current.version !== expectedVersion)
      return null;
    if (current.history.length >= MAX_AUDIT_EVENTS) throw new ClinicFinanceAuditCapacityError();
    const version = current.version + 1;
    return this.updateInvoiceWithHistory(
      invoiceCollection,
      context.tenantId,
      invoiceId,
      expectedVersion,
      {
        status: 'DRAFT',
        invoiceNumber: null,
        totals: null,
        reviewedPolicy: null,
        reviewedAt: null,
        reviewedBy: null,
        version,
        updatedAt: new Date(at),
        updatedBy: actorUserId,
      },
      createClinicInvoiceAuditEvent(
        'RETURNED_TO_DRAFT',
        actorUserId,
        at,
        version,
        `Returned to draft: ${reason}`,
      ),
      'REVIEWED',
    );
  }

  async issueInvoice(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    invoiceId: string,
    expectedVersion: number,
    actorUserId: string,
    at: Date,
  ): Promise<ClinicInvoice | null> {
    const settingsCollection = await this.getSettingsCollection(context, route);
    await this.assertSettingsIndex(settingsCollection);
    const invoiceCollection = await this.getInvoiceCollection(context, route);
    await this.assertInvoiceIndexes(invoiceCollection);
    let invoice = await this.findForMutation(invoiceCollection, context.tenantId, invoiceId);
    if (invoice?.status === 'ISSUED') return invoice;
    if (
      !invoice ||
      invoice.status !== 'REVIEWED' ||
      invoice.version !== expectedVersion ||
      !invoice.reviewedPolicy
    ) {
      return null;
    }
    const settings = await settingsCollection.findOne({ _tenantId: context.tenantId });
    if (!settings || settings.version !== invoice.reviewedPolicy.settingsVersion) {
      throw new ClinicInvoiceStateConflictError();
    }

    if (settings.pendingIssue) {
      const pending = settings.pendingIssue;
      const pendingInvoice = await this.finalizePendingIssue(
        settingsCollection,
        invoiceCollection,
        context.tenantId,
        pending,
      );
      if (pending.invoiceId === invoiceId) return pendingInvoice;
      invoice = await this.findForMutation(invoiceCollection, context.tenantId, invoiceId);
      if (
        !invoice ||
        invoice.status !== 'REVIEWED' ||
        invoice.version !== expectedVersion ||
        !invoice.reviewedPolicy
      ) {
        return null;
      }
    }

    if (invoice.reviewedPolicy.numberingPolicy.mode === 'MANUAL') {
      const manualNumber = invoice.manualInvoiceNumber;
      if (!manualNumber || settings.numberingPolicy?.mode !== 'MANUAL') {
        throw new ClinicInvoiceStateConflictError();
      }
      const reservation: PendingIssue = {
        invoiceId,
        invoiceNumber: manualNumber,
        actorUserId,
        at: new Date(at),
        expectedVersion,
      };
      const reservationResult = await settingsCollection.updateOne(
        {
          _tenantId: context.tenantId,
          version: settings.version,
          pendingIssue: null,
        },
        { $set: { pendingIssue: reservation } },
      );
      if (reservationResult.matchedCount === 0) throw new ClinicInvoiceStateConflictError();
      return this.finalizePendingIssue(
        settingsCollection,
        invoiceCollection,
        context.tenantId,
        reservation,
      );
    }

    if (settings.numberingPolicy?.mode !== 'SEQUENTIAL' || settings.nextSequence === null) {
      throw new ClinicInvoiceStateConflictError();
    }

    const currentSettings = await settingsCollection.findOne({ _tenantId: context.tenantId });
    if (
      !currentSettings ||
      currentSettings.version !== invoice.reviewedPolicy.settingsVersion ||
      currentSettings.pendingIssue ||
      currentSettings.numberingPolicy?.mode !== 'SEQUENTIAL' ||
      currentSettings.nextSequence === null ||
      currentSettings.nextSequence >= Number.MAX_SAFE_INTEGER
    ) {
      throw new ClinicInvoiceStateConflictError();
    }
    const sequence = currentSettings.nextSequence;
    const numberPolicy = invoice.reviewedPolicy.numberingPolicy;
    const invoiceNumber = formatClinicInvoiceNumber(
      numberPolicy.prefix,
      sequence,
      numberPolicy.minimumDigits,
    );
    const reservation: PendingIssue = {
      invoiceId,
      invoiceNumber,
      actorUserId,
      at: new Date(at),
      expectedVersion,
    };
    const reservationResult = await settingsCollection.updateOne(
      {
        _tenantId: context.tenantId,
        version: currentSettings.version,
        nextSequence: sequence,
        pendingIssue: null,
      },
      {
        $set: {
          nextSequence: sequence + 1,
          pendingIssue: reservation,
        },
      },
    );
    if (reservationResult.matchedCount === 0) throw new ClinicInvoiceStateConflictError();
    return this.finalizePendingIssue(
      settingsCollection,
      invoiceCollection,
      context.tenantId,
      reservation,
    );
  }

  async createTransfer(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    transfer: ClinicInvoiceTransfer,
  ): Promise<ClinicInvoiceTransfer> {
    const collection = await this.getTransferCollection(context, route);
    await this.assertTransferIndexes(collection);
    const document: ClinicInvoiceTransferDocument = {
      ...structuredClone(transfer),
      _id: transfer.id,
      _tenantId: context.tenantId,
    };
    delete (document as Document).id;
    delete (document as Document).tenantId;
    try {
      await collection.insertOne(document);
      return toTransfer(document);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        if (transfer.idempotencyKeyHash) {
          const existing = await collection.findOne({
            _tenantId: context.tenantId,
            invoiceId: transfer.invoiceId,
            submittedBy: transfer.submittedBy,
            idempotencyKeyHash: transfer.idempotencyKeyHash,
          });
          if (existing) return toTransfer(existing);
        }
        throw new ClinicInvoiceStateConflictError();
      }
      throw new TenantStorageUnavailableError();
    }
  }

  async listTransfers(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    filters: { invoiceId?: string; status?: ClinicInvoiceTransferStatus },
  ): Promise<ClinicInvoiceTransfer[]> {
    const collection = await this.getTransferCollection(context, route);
    await this.assertTransferIndexes(collection);
    try {
      const documents = await collection
        .find({
          _tenantId: context.tenantId,
          ...(filters.invoiceId ? { invoiceId: filters.invoiceId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        })
        .sort({ submittedAt: -1, _id: -1 })
        .limit(100)
        .toArray();
      return documents.map(toTransfer);
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async findTransfer(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    transferId: string,
  ): Promise<ClinicInvoiceTransfer | null> {
    const collection = await this.getTransferCollection(context, route);
    await this.assertTransferIndexes(collection);
    try {
      const document = await collection.findOne({ _id: transferId, _tenantId: context.tenantId });
      return document ? toTransfer(document) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  async reviewTransfer(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
    transferId: string,
    expectedVersion: number,
    status: 'APPROVED' | 'REJECTED',
    actorUserId: string,
    reason: string,
    at: Date,
  ): Promise<ClinicInvoiceTransfer | null> {
    const collection = await this.getTransferCollection(context, route);
    await this.assertTransferIndexes(collection);
    const event = { action: status, actorUserId, at: new Date(at), reason };
    try {
      const result = await collection.updateOne(
        {
          _id: transferId,
          _tenantId: context.tenantId,
          status: 'PENDING_REVIEW',
          version: expectedVersion,
          $expr: { $lt: [{ $size: '$history' }, MAX_TRANSFER_HISTORY] },
        },
        {
          $set: {
            status,
            reviewedBy: actorUserId,
            reviewedAt: new Date(at),
            reviewReason: reason,
            version: expectedVersion + 1,
          },
          $push: { history: event },
        } as Document,
      );
      if (result.matchedCount !== 1) return null;
      const updated = await collection.findOne({ _id: transferId, _tenantId: context.tenantId });
      return updated ? toTransfer(updated) : null;
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw new TenantStorageUnavailableError();
    }
  }

  async ensureIndexesForTarget(target: TenantStorageTargetRecord): Promise<void> {
    try {
      const database = await this.clients.getDatabase(target);
      const settings = database.collection<ClinicInvoiceSettingsDocument>(SETTINGS_COLLECTION_NAME);
      const invoices = database.collection<ClinicInvoiceDocument>(INVOICE_COLLECTION_NAME);
      const transfers =
        database.collection<ClinicInvoiceTransferDocument>(TRANSFER_COLLECTION_NAME);
      await settings.createIndex(SETTINGS_UNIQUE_INDEX.key, {
        name: SETTINGS_UNIQUE_INDEX.name,
        unique: true,
      });
      for (const definition of INVOICE_INDEXES) {
        await invoices.createIndex(definition.key, {
          name: definition.name,
          ...(definition.unique ? { unique: true } : {}),
          ...(definition.partialFilterExpression
            ? { partialFilterExpression: definition.partialFilterExpression }
            : {}),
        });
      }
      for (const definition of TRANSFER_INDEXES) {
        await transfers.createIndex(definition.key, {
          name: definition.name,
          ...(definition.unique ? { unique: true } : {}),
          ...(definition.partialFilterExpression
            ? { partialFilterExpression: definition.partialFilterExpression }
            : {}),
        });
      }
      if (!(await this.hasRequiredIndexes(settings, invoices, transfers))) {
        throw new TenantStorageUnavailableError();
      }
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async getSettingsCollection(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<Collection<ClinicInvoiceSettingsDocument>> {
    const database = await this.getDatabase(context, route);
    return database.collection<ClinicInvoiceSettingsDocument>(SETTINGS_COLLECTION_NAME);
  }

  private async getInvoiceCollection(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<Collection<ClinicInvoiceDocument>> {
    const database = await this.getDatabase(context, route);
    return database.collection<ClinicInvoiceDocument>(INVOICE_COLLECTION_NAME);
  }

  private async getTransferCollection(
    context: TrustedTenantContext,
    route: TenantStorageRoute,
  ): Promise<Collection<ClinicInvoiceTransferDocument>> {
    const database = await this.getDatabase(context, route);
    return database.collection<ClinicInvoiceTransferDocument>(TRANSFER_COLLECTION_NAME);
  }

  private async getDatabase(context: TrustedTenantContext, route: TenantStorageRoute): Promise<Db> {
    if (!context || !isWellFormedTrustedTenantContext(context)) {
      throw new TenantContextInvalidError();
    }
    if (!route || !Array.isArray(route.placements) || route.placements.length === 0) {
      throw new TenantStorageNotConfiguredError();
    }
    if (route.placements.length !== 1) throw new TenantStorageUnavailableError();
    const placement = route.placements[0];
    if (!placement || typeof placement.placementId !== 'string') {
      throw new TenantStorageUnavailableError();
    }

    try {
      const target = await this.targetResolver.findActivePrimaryTarget(
        context,
        placement.placementId,
      );
      if (
        !target ||
        target.tenantId.toLowerCase() !== context.tenantId.toLowerCase() ||
        target.status !== 'ACTIVE' ||
        !target.isPrimary
      ) {
        throw new TenantStorageNotConfiguredError();
      }
      return await this.clients.getDatabase(target);
    } catch (error) {
      if (
        error instanceof TenantContextInvalidError ||
        error instanceof TenantStorageNotConfiguredError ||
        error instanceof TenantStorageUnavailableError
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }
  }

  private async assertSettingsIndex(
    collection: Collection<ClinicInvoiceSettingsDocument>,
  ): Promise<void> {
    try {
      if (
        !(await this.hasIndex(
          collection,
          SETTINGS_UNIQUE_INDEX.name,
          SETTINGS_UNIQUE_INDEX.key,
          true,
        ))
      ) {
        throw new TenantStorageUnavailableError();
      }
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async assertInvoiceIndexes(collection: Collection<ClinicInvoiceDocument>): Promise<void> {
    try {
      const indexes = await collection.indexes();
      const ready = INVOICE_INDEXES.every((definition) =>
        indexes.some((index) => matchesIndex(index, definition)),
      );
      if (!ready) throw new TenantStorageUnavailableError();
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async assertTransferIndexes(
    collection: Collection<ClinicInvoiceTransferDocument>,
  ): Promise<void> {
    try {
      const indexes = await collection.indexes();
      if (!TRANSFER_INDEXES.every((definition) => indexes.some((index) => matchesIndex(index, definition)))) {
        throw new TenantStorageUnavailableError();
      }
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async hasRequiredIndexes(
    settings: Collection<ClinicInvoiceSettingsDocument>,
    invoices: Collection<ClinicInvoiceDocument>,
    transfers: Collection<ClinicInvoiceTransferDocument>,
  ): Promise<boolean> {
    const settingsReady = await this.hasIndex(
      settings,
      SETTINGS_UNIQUE_INDEX.name,
      SETTINGS_UNIQUE_INDEX.key,
      true,
    );
    const invoiceIndexes = await invoices.indexes();
    const transferIndexes = await transfers.indexes();
    return (
      settingsReady &&
      INVOICE_INDEXES.every((definition) =>
        invoiceIndexes.some((index) => matchesIndex(index, definition)),
      ) &&
      TRANSFER_INDEXES.every((definition) =>
        transferIndexes.some((index) => matchesIndex(index, definition)),
      )
    );
  }

  private async hasIndex<T extends Document>(
    collection: Collection<T>,
    name: string,
    key: IndexSpecification,
    unique: boolean,
  ): Promise<boolean> {
    const indexes = await collection.indexes();
    return indexes.some(
      (index) => index.name === name && index.unique === unique && sameIndexKey(index.key, key),
    );
  }

  private async findForMutation(
    collection: Collection<ClinicInvoiceDocument>,
    tenantId: string,
    invoiceId: string,
  ): Promise<ClinicInvoice | null> {
    try {
      const document = await collection.findOne({ _id: invoiceId, _tenantId: tenantId });
      return document ? toInvoice(document) : null;
    } catch {
      throw new TenantStorageUnavailableError();
    }
  }

  private async updateInvoiceWithHistory(
    collection: Collection<ClinicInvoiceDocument>,
    tenantId: string,
    invoiceId: string,
    expectedVersion: number,
    fields: Document,
    event: ClinicInvoiceAuditEvent,
    expectedStatus: 'DRAFT' | 'REVIEWED' = 'DRAFT',
  ): Promise<ClinicInvoice | null> {
    try {
      const result = await collection.updateOne(
        {
          _id: invoiceId,
          _tenantId: tenantId,
          status: expectedStatus,
          version: expectedVersion,
          $expr: { $lt: [{ $size: '$history' }, MAX_AUDIT_EVENTS] },
        },
        { $set: fields, $push: { history: event } } as Document,
      );
      if (result.matchedCount === 0) {
        const current = await collection.findOne({ _id: invoiceId, _tenantId: tenantId });
        if (current && current.history.length >= MAX_AUDIT_EVENTS) {
          throw new ClinicFinanceAuditCapacityError();
        }
        return null;
      }
      const updated = await collection.findOne({ _id: invoiceId, _tenantId: tenantId });
      return updated ? toInvoice(updated) : null;
    } catch (error) {
      if (error instanceof ClinicFinanceAuditCapacityError) throw error;
      throw new TenantStorageUnavailableError();
    }
  }

  private async finalizePendingIssue(
    settings: Collection<ClinicInvoiceSettingsDocument>,
    invoices: Collection<ClinicInvoiceDocument>,
    tenantId: string,
    pending: PendingIssue,
  ): Promise<ClinicInvoice> {
    try {
      let invoice = await invoices.findOne({
        _id: pending.invoiceId,
        _tenantId: tenantId,
      });
      if (!invoice) throw new TenantStorageUnavailableError();
      if (invoice.status !== 'ISSUED') {
        if (
          invoice.status !== 'REVIEWED' ||
          invoice.version !== pending.expectedVersion ||
          invoice.history.length >= MAX_AUDIT_EVENTS
        ) {
          if (invoice.history.length >= MAX_AUDIT_EVENTS) {
            throw new ClinicFinanceAuditCapacityError();
          }
          throw new TenantStorageUnavailableError();
        }
        const version = invoice.version + 1;
        const event = createClinicInvoiceAuditEvent(
          'ISSUED',
          pending.actorUserId,
          pending.at,
          version,
          'Invoice issued',
        );
        try {
          const result = await invoices.updateOne(
            {
              _id: pending.invoiceId,
              _tenantId: tenantId,
              status: 'REVIEWED',
              version: pending.expectedVersion,
              $expr: { $lt: [{ $size: '$history' }, MAX_AUDIT_EVENTS] },
            },
            {
              $set: {
                invoiceNumber: pending.invoiceNumber,
                status: 'ISSUED',
                version,
                updatedAt: new Date(pending.at),
                updatedBy: pending.actorUserId,
                issuedAt: new Date(pending.at),
                issuedBy: pending.actorUserId,
              },
              $push: { history: event },
            } as Document,
          );
          if (result.matchedCount === 0) {
            invoice = await invoices.findOne({ _id: pending.invoiceId, _tenantId: tenantId });
            if (invoice?.status !== 'ISSUED' || invoice.invoiceNumber !== pending.invoiceNumber) {
              throw new TenantStorageUnavailableError();
            }
          } else {
            invoice = await invoices.findOne({ _id: pending.invoiceId, _tenantId: tenantId });
          }
        } catch (error) {
          if (error instanceof ClinicFinanceAuditCapacityError) throw error;
          if (isDuplicateKeyError(error)) {
            const released = await settings.updateOne(
              {
                _tenantId: tenantId,
                'pendingIssue.invoiceId': pending.invoiceId,
                'pendingIssue.invoiceNumber': pending.invoiceNumber,
              },
              { $set: { pendingIssue: null } },
            );
            if (released.matchedCount === 0) throw new TenantStorageUnavailableError();
            throw new ClinicInvoiceNumberConflictError();
          }
          throw error;
        }
      } else if (invoice.invoiceNumber !== pending.invoiceNumber) {
        throw new TenantStorageUnavailableError();
      }

      const cleared = await settings.updateOne(
        {
          _tenantId: tenantId,
          'pendingIssue.invoiceId': pending.invoiceId,
          'pendingIssue.invoiceNumber': pending.invoiceNumber,
        },
        { $set: { pendingIssue: null } },
      );
      if (cleared.matchedCount === 0) {
        const currentSettings = await settings.findOne({ _tenantId: tenantId });
        if (currentSettings?.pendingIssue) throw new TenantStorageUnavailableError();
      }
      if (!invoice) throw new TenantStorageUnavailableError();
      return toInvoice(invoice);
    } catch (error) {
      if (
        error instanceof ClinicFinanceAuditCapacityError ||
        error instanceof ClinicInvoiceNumberConflictError ||
        error instanceof ClinicInvoiceStateConflictError ||
        error instanceof TenantStorageUnavailableError
      ) {
        throw error;
      }
      throw new TenantStorageUnavailableError();
    }
  }
}

function toSettings(document: ClinicInvoiceSettingsDocument): ClinicInvoiceSettings {
  return {
    tenantId: document._tenantId,
    version: document.version,
    currencyCode: document.currencyCode,
    lineRounding: document.lineRounding,
    customFields: structuredClone(document.customFields),
    taxPolicies: structuredClone(document.taxPolicies),
    numberingPolicy: structuredClone(document.numberingPolicy),
    bankTransfer: structuredClone(
      document.bankTransfer ?? DEFAULT_CLINIC_INVOICE_SETTINGS.bankTransfer,
    ),
    nextSequence: document.nextSequence,
    updatedAt: document.updatedAt ? new Date(document.updatedAt) : null,
    updatedBy: document.updatedBy ?? null,
    revisions: structuredClone(document.revisions ?? []),
  };
}

function toTransfer(document: ClinicInvoiceTransferDocument): ClinicInvoiceTransfer {
  return {
    id: document._id,
    tenantId: document._tenantId,
    invoiceId: document.invoiceId,
    status: document.status,
    amountMinor: document.amountMinor,
    currencyCode: document.currencyCode,
    receiptFileName: document.receiptFileName,
    receiptMimeType: document.receiptMimeType,
    receiptSha256: document.receiptSha256,
    receiptBytes: Buffer.from(document.receiptBytes),
    submittedBy: document.submittedBy,
    submittedAt: new Date(document.submittedAt),
    reviewedBy: document.reviewedBy ?? null,
    reviewedAt: document.reviewedAt ? new Date(document.reviewedAt) : null,
    reviewReason: document.reviewReason ?? null,
    version: document.version,
    history: structuredClone(document.history ?? []),
    idempotencyKeyHash: document.idempotencyKeyHash ?? null,
  };
}

function toInvoice(document: ClinicInvoiceDocument): ClinicInvoice {
  return {
    id: document._id,
    tenantId: document._tenantId,
    invoiceNumber: document.invoiceNumber ?? null,
    manualInvoiceNumber: document.manualInvoiceNumber ?? null,
    status: document.status,
    recipientName: document.recipientName,
    invoiceDate: document.invoiceDate,
    customFieldValues: structuredClone(document.customFieldValues ?? {}),
    taxPolicyId: document.taxPolicyId ?? null,
    currencyCode: document.currencyCode,
    lines: structuredClone(document.lines),
    totals: document.totals ? structuredClone(document.totals) : null,
    reviewedPolicy: document.reviewedPolicy ? structuredClone(document.reviewedPolicy) : null,
    version: document.version,
    createdAt: new Date(document.createdAt),
    updatedAt: new Date(document.updatedAt),
    createdBy: document.createdBy,
    updatedBy: document.updatedBy,
    reviewedAt: document.reviewedAt ? new Date(document.reviewedAt) : null,
    reviewedBy: document.reviewedBy ?? null,
    issuedAt: document.issuedAt ? new Date(document.issuedAt) : null,
    issuedBy: document.issuedBy ?? null,
    creationKeyHash: document.creationKeyHash ?? null,
    creationFingerprint: document.creationFingerprint ?? null,
    history: structuredClone(document.history ?? []),
  };
}

function toInvoiceDocument(tenantId: string, invoice: ClinicInvoice): ClinicInvoiceDocument {
  const rest = Object.fromEntries(
    Object.entries(invoice).filter(([key]) => key !== 'id' && key !== 'tenantId'),
  ) as Omit<ClinicInvoice, 'id' | 'tenantId'>;
  return { ...rest, _id: invoice.id, _tenantId: tenantId };
}

function withoutUndefined(value: Record<string, unknown>): Document {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function sameIndexKey(actual: IndexSpecification, expected: IndexSpecification): boolean {
  const actualEntries = Object.entries(actual as Document);
  const expectedEntries = Object.entries(expected as Document);
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([actualKey, actualValue], index) =>
        expectedEntries[index]?.[0] === actualKey && expectedEntries[index]?.[1] === actualValue,
    )
  );
}

function matchesIndex(
  index: IndexDescription,
  expected: (typeof INVOICE_INDEXES)[number],
): boolean {
  const actual = index as IndexDescription & { partialFilterExpression?: Document };
  return (
    actual.name === expected.name &&
    (actual.unique === true) === (expected.unique === true) &&
    sameIndexKey(actual.key, expected.key) &&
    stableStringify(actual.partialFilterExpression ?? null) ===
      stableStringify(expected.partialFilterExpression ?? null)
  );
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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
