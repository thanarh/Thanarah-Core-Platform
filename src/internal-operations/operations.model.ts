import { z } from 'zod';

export const PERMISSIONS = [
  'organization.read',
  'organization.manage',
  'people.read',
  'people.manage',
  'access.manage',
  'hr.read',
  'hr.manage',
  'hr.approve',
  'crm.read',
  'crm.manage',
  'customers.read',
  'customers.manage',
  'customers.manage_all',
  'customers.review',
  'customers.activate',
  'customers.catalog',
  'requests.read',
  'requests.manage',
  'requests.approve',
  'policies.read',
  'policies.manage',
  'policies.approve',
  'finance.read',
  'finance.manage',
  'finance.post',
  'audit.read',
  'dashboard.ceo',
  'dashboard.cto',
  'dashboard.director',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const BUILTIN_ROLES: Record<string, { name: string; permissions: readonly Permission[] }> = {
  CEO: {
    name: 'الرئيس التنفيذي CEO',
    permissions: PERMISSIONS.filter((p) => p !== 'access.manage'),
  },
  CTO: {
    name: 'الرئيس التقني CTO',
    permissions: [
      'organization.read',
      'people.read',
      'requests.read',
      'requests.manage',
      'dashboard.cto',
    ],
  },
  GENERAL_DIRECTOR: {
    name: 'المدير التنفيذي العام',
    permissions: [
      'organization.read',
      'organization.manage',
      'people.read',
      'people.manage',
      'crm.read',
      'crm.manage',
      'customers.read',
      'customers.manage',
      'customers.manage_all',
      'customers.review',
      'requests.read',
      'requests.manage',
      'requests.approve',
      'dashboard.director',
    ],
  },
  HR: {
    name: 'الموارد البشرية',
    permissions: [
      'organization.read',
      'people.read',
      'people.manage',
      'hr.read',
      'hr.manage',
      'policies.read',
      'policies.manage',
      'requests.read',
      'requests.manage',
    ],
  },
  ACCOUNTANT: {
    name: 'المحاسب',
    permissions: [
      'people.read',
      'hr.read',
      'crm.read',
      'finance.read',
      'finance.manage',
      'policies.read',
      'policies.manage',
      'requests.read',
      'requests.manage',
    ],
  },
  FINANCIAL_CONTROLLER: {
    name: 'المراقب المالي',
    permissions: [
      'finance.read',
      'finance.post',
      'hr.read',
      'hr.approve',
      'policies.read',
      'policies.approve',
      'audit.read',
    ],
  },
  ACCOUNT_MANAGER: {
    name: 'مدير الحسابات والعملاء',
    permissions: [
      'people.read',
      'crm.read',
      'crm.manage',
      'requests.read',
      'requests.manage',
      'customers.read',
      'customers.manage',
    ],
  },
  EMPLOYEE: {
    name: 'موظف',
    permissions: ['organization.read', 'requests.read', 'requests.manage'],
  },
};
const text = z.string().trim().min(1).max(200);
const id = z.string().uuid();
const date = z.iso.date();
const minor = z.number().int().min(0).max(1_000_000_000_000);
const active = z.enum(['ACTIVE', 'ARCHIVED']);
export const lineSchema = z
  .object({ accountId: id, debitMinor: minor, creditMinor: minor })
  .strict();
export const schemas = {
  units: z
    .object({
      name: text,
      unitType: z.enum(['COMPANY', 'DEPARTMENT', 'SECTION']),
      parentId: id.nullable(),
      status: active,
    })
    .strict(),
  roles: z
    .object({
      name: text,
      permissions: z.array(z.enum(PERMISSIONS)).min(1).max(PERMISSIONS.length),
      status: active,
    })
    .strict(),
  employees: z
    .object({
      name: text,
      userId: id.nullable(),
      unitId: id,
      jobTitle: text,
      roleIds: z.array(z.string().min(1).max(64)).max(20),
      status: z.enum(['ACTIVE', 'INACTIVE']),
    })
    .strict(),
  contracts: z
    .object({
      employeeId: id,
      title: text,
      startDate: date,
      endDate: date.nullable(),
      monthlyMinor: minor.refine((v) => v > 0),
      currency: z.literal('SAR'),
      status: z.enum(['DRAFT', 'APPROVED', 'ENDED', 'CANCELLED']),
    })
    .strict(),
  clients: z
    .object({
      name: text,
      contact: z.string().trim().max(200),
      ownerId: id,
      stage: z.enum(['LEAD', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST']),
    })
    .strict(),
  requests: z
    .object({
      title: text,
      description: z.string().trim().max(2000),
      category: z.enum(['HR', 'SALES', 'FINANCE', 'TECHNICAL', 'OPERATIONS']),
      ownerId: id,
      dueDate: date,
      status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ESCALATED', 'CANCELLED']),
    })
    .strict(),
  accounts: z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{1,20}$/),
      name: text,
      type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
      currency: z.literal('SAR'),
      status: active,
    })
    .strict(),
  policies: z
    .object({
      name: text,
      type: z.enum(['PAYROLL', 'COMMISSION', 'PROFIT']),
      currency: z.literal('SAR'),
      rateBps: z.number().int().min(0).max(10000),
      maxAmountMinor: minor.refine((v) => v > 0),
      debitAccountId: id,
      creditAccountId: id,
      effectiveFrom: date,
      effectiveTo: date.nullable(),
      rounding: z.literal('HALF_UP'),
      status: z.enum(['DRAFT', 'APPROVED', 'RETIRED', 'CANCELLED']),
    })
    .strict(),
  journals: z
    .object({
      memo: text,
      kind: z.enum([
        'GENERAL',
        'DEPOSIT',
        'WITHDRAWAL',
        'PAYROLL',
        'COMMISSION',
        'PROFIT',
        'REVERSAL',
      ]),
      date,
      currency: z.literal('SAR'),
      lines: z.array(lineSchema).min(2).max(100),
      status: z.enum(['DRAFT', 'POSTED', 'CANCELLED']),
      clientId: id.optional(),
      sourceKey: z.string().min(1).max(200).optional(),
      reversalOf: id.optional(),
      calculation: z
        .object({
          policyId: id,
          policyVersion: z.number().int(),
          employeeId: id,
          period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          basisMinor: minor,
          amountMinor: minor,
          rateBps: z.number().int(),
          contractId: id.optional(),
          contractVersion: z.number().int().optional(),
          sourceJournalId: id.optional(),
          clientId: id.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
};
export type Resource = keyof typeof schemas;
export const RESOURCES = Object.keys(schemas) as Resource[];
export type DataMap = { [K in Resource]: z.infer<(typeof schemas)[K]> };
export const recordBaseSchema = z.object({
  _id: z.string().uuid(),
  kind: z.enum(RESOURCES as [Resource, ...Resource[]]),
  version: z.number().int().min(1),
  createdBy: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.date().optional(),
});
export interface RecordBase {
  _id: string;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
}
export type OpsRecord<K extends Resource = Resource> = RecordBase & { kind: K; data: DataMap[K] };
export type AnyRecord = { [K in Resource]: OpsRecord<K> }[Resource];
export const READ_PERMISSIONS: Record<Resource, Permission> = {
  units: 'organization.read',
  roles: 'people.read',
  employees: 'people.read',
  contracts: 'hr.read',
  clients: 'crm.read',
  requests: 'requests.read',
  accounts: 'finance.read',
  policies: 'policies.read',
  journals: 'finance.read',
};
export const WRITE_PERMISSIONS: Record<Resource, Permission> = {
  units: 'organization.manage',
  roles: 'access.manage',
  employees: 'people.manage',
  contracts: 'hr.manage',
  clients: 'crm.manage',
  requests: 'requests.manage',
  accounts: 'finance.manage',
  policies: 'policies.manage',
  journals: 'finance.manage',
};
export const commandSchema = z
  .object({ operationId: id, data: z.unknown(), version: z.number().int().min(1).optional() })
  .strict();
export const actionSchema = z
  .object({
    operationId: id,
    version: z.number().int().min(1),
    action: z.enum([
      'submit',
      'approve',
      'reject',
      'escalate',
      'retire',
      'end',
      'post',
      'reverse',
      'cancel',
    ]),
    reason: z.string().trim().min(3).max(500),
    ownerId: id.optional(),
  })
  .strict();
export const accrualSchema = z
  .object({
    operationId: id,
    policyId: id,
    employeeId: id,
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    sourceJournalId: id.optional(),
    clientId: id.optional(),
  })
  .strict();
