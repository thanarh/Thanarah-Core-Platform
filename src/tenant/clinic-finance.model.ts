export type ClinicInvoiceStatus = 'DRAFT' | 'REVIEWED' | 'ISSUED';

export type InvoiceRoundingMethod = 'HALF_UP' | 'DOWN' | 'UP';

export interface ClinicInvoiceCustomField {
  key: string;
  label: string;
  type: 'TEXT' | 'DATE' | 'BOOLEAN';
  required: boolean;
}

export type ClinicInvoiceTaxPolicy =
  | {
      id: string;
      name: string;
      type: 'NO_TAX';
    }
  | {
      id: string;
      name: string;
      type: 'RATE';
      rateBasisPoints: number;
      calculation: 'PER_LINE' | 'SUBTOTAL';
      rounding: InvoiceRoundingMethod;
    };

export type ClinicInvoiceNumberingPolicy =
  | {
      mode: 'MANUAL';
      prefix: string;
      minimumDigits: number;
    }
  | {
      mode: 'SEQUENTIAL';
      prefix: string;
      minimumDigits: number;
      startingNumber: number;
    };

export interface ClinicBankTransferSettings {
  enabled: boolean;
  bankName: string | null;
  accountHolder: string | null;
  iban: string | null;
  currencyCode: string | null;
}

export interface ClinicInvoiceSettings {
  tenantId: string;
  version: number;
  currencyCode: string;
  lineRounding: InvoiceRoundingMethod | null;
  customFields: ClinicInvoiceCustomField[];
  taxPolicies: ClinicInvoiceTaxPolicy[];
  numberingPolicy: ClinicInvoiceNumberingPolicy | null;
  bankTransfer: ClinicBankTransferSettings;
  nextSequence: number | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  revisions: ClinicInvoiceSettingsRevision[];
}

export interface ClinicInvoiceSettingsRevision {
  version: number;
  changedAt: Date;
  changedBy: string;
  settings: Omit<
    ClinicInvoiceSettings,
    'tenantId' | 'version' | 'updatedAt' | 'updatedBy' | 'revisions'
  >;
}

export interface ClinicInvoiceLineInput {
  id: string;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
}

export interface ClinicInvoiceTotals {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  lineTotalsMinor: number[];
}

export interface ClinicInvoiceReviewedPolicy {
  settingsVersion: number;
  currencyCode: string;
  lineRounding: InvoiceRoundingMethod;
  taxPolicy: ClinicInvoiceTaxPolicy;
  numberingPolicy: ClinicInvoiceNumberingPolicy;
}

export interface ClinicInvoiceAuditEvent {
  id: string;
  action: 'CREATED' | 'UPDATED' | 'REVIEWED' | 'RETURNED_TO_DRAFT' | 'ISSUED';
  actorUserId: string;
  at: Date;
  version: number;
  summary: string;
}

export interface ClinicInvoice {
  id: string;
  tenantId: string;
  patientId: string | null;
  invoiceNumber: string | null;
  manualInvoiceNumber: string | null;
  status: ClinicInvoiceStatus;
  recipientName: string;
  invoiceDate: string;
  customFieldValues: Record<string, string | boolean>;
  taxPolicyId: string | null;
  currencyCode: string;
  lines: ClinicInvoiceLineInput[];
  totals: ClinicInvoiceTotals | null;
  reviewedPolicy: ClinicInvoiceReviewedPolicy | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  issuedAt: Date | null;
  issuedBy: string | null;
  creationKeyHash: string | null;
  creationFingerprint: string | null;
  history: ClinicInvoiceAuditEvent[];
}

export type ClinicInvoiceTransferStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface ClinicInvoiceTransferEvent {
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  actorUserId: string;
  at: Date;
  reason: string | null;
}

export interface ClinicInvoiceTransfer {
  id: string;
  tenantId: string;
  invoiceId: string;
  status: ClinicInvoiceTransferStatus;
  amountMinor: number;
  currencyCode: string;
  receiptFileName: string;
  receiptMimeType: string;
  receiptSha256: string;
  receiptBytes: Buffer;
  submittedBy: string;
  submittedAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  version: number;
  history: ClinicInvoiceTransferEvent[];
  idempotencyKeyHash: string | null;
}

export type ClinicInvoiceTransferView = Omit<
  ClinicInvoiceTransfer,
  'tenantId' | 'receiptBytes' | 'idempotencyKeyHash'
>;

export interface ClinicInvoiceListResult {
  items: ClinicInvoice[];
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}

export type ClinicInvoiceView = Omit<
  ClinicInvoice,
  | 'tenantId'
  | 'creationKeyHash'
  | 'creationFingerprint'
  | 'createdBy'
  | 'updatedBy'
  | 'reviewedBy'
  | 'issuedBy'
>;

export interface PatientInvoiceTransferStatusView {
  status: ClinicInvoiceTransferStatus;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewReason: string | null;
  version: number;
}

export type PatientClinicInvoiceView = Pick<
  ClinicInvoiceView,
  | 'id'
  | 'invoiceNumber'
  | 'status'
  | 'recipientName'
  | 'invoiceDate'
  | 'customFieldValues'
  | 'currencyCode'
  | 'lines'
  | 'totals'
  | 'version'
  | 'issuedAt'
> & {
  transferStatus: PatientInvoiceTransferStatusView | null;
};

export type ClinicInvoicePage = Omit<ClinicInvoiceListResult, 'items'> & {
  items: ClinicInvoiceView[];
};

export const DEFAULT_CLINIC_INVOICE_SETTINGS: Omit<ClinicInvoiceSettings, 'tenantId'> = {
  version: 0,
  currencyCode: 'SAR',
  lineRounding: null,
  customFields: [],
  taxPolicies: [],
  numberingPolicy: null,
  bankTransfer: {
    enabled: false,
    bankName: null,
    accountHolder: null,
    iban: null,
    currencyCode: null,
  },
  nextSequence: null,
  updatedAt: null,
  updatedBy: null,
  revisions: [],
};
