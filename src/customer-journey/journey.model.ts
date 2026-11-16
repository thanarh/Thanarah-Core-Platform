import { z } from 'zod';
import { Binary } from 'mongodb';
export const id = z.string().uuid();
export const short = z.string().trim().min(1).max(191);
export const reason = z.string().trim().min(3).max(500);
export const minor = z.string().regex(/^(0|[1-9]\d{0,11})$/u);
export const command = { operationId: id };
export const version = z.number().int().nonnegative();
export const packageCode = z.enum(['Lite', 'Pro', 'Customize']);
const key = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/u);
export const requirement = z.object({ key, label: short, required: z.boolean() }).strict();
export const packageSchema = z
  .object({
    code: packageCode,
    description: z.string().trim().max(1000),
    features: z.array(short).max(30),
    planId: id.nullable(),
    priceMinor: minor.nullable(),
    published: z.boolean(),
  })
  .strict();
export const sellerSchema = z
  .object({
    name: short,
    address: z.string().trim().min(5).max(500),
    taxNumber: z.string().trim().min(1).max(40),
    prefix: z.string().regex(/^[A-Z][A-Z0-9-]{0,11}$/u),
  })
  .strict();
export const catalogDataSchema = z
  .object({
    registrationOpen: z.boolean(),
    ordersOpen: z.boolean().optional(),
    termsText: z.string().trim().max(10000),
    services: z
      .array(
        z
          .object({
            key,
            title: short,
            description: z.string().trim().min(1).max(3000),
            published: z.boolean(),
          })
          .strict(),
      )
      .max(30),
    packages: z.array(packageSchema).length(3),
    documents: z.array(requirement).max(10),
    seller: sellerSchema.nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    for (const list of [
      data.services.map((x) => x.key),
      data.documents.map((x) => x.key),
      data.packages.map((x) => x.code),
    ])
      if (new Set(list).size !== list.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate catalog key' });
  })
  .transform((data) => ({
    ...data,
    ordersOpen: data.ordersOpen ?? data.registrationOpen,
  }));
export const catalogSchema = z
  .object({
    _id: z.literal('catalog'),
    version,
    draft: catalogDataSchema,
    live: catalogDataSchema.nullable(),
    liveVersion: version,
    updatedBy: id.nullable(),
    updatedAt: z.date().nullable(),
    publishedBy: id.nullable(),
    publishedAt: z.date().nullable(),
  })
  .strict();
export const profileSchema = z
  .object({
    legalName: short,
    displayName: short,
    registrationNumber: short,
    taxNumber: z.string().trim().max(40).optional(),
    city: short,
    address: z.string().trim().min(5).max(500),
    contactName: short,
    phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/u),
  })
  .strict();
export const profileInputSchema = profileSchema
  .extend({ taxNumber: z.string().trim().min(1).max(40) })
  .strict();
export const accountSchema = z
  .object({
    _id: id,
    userId: id,
    email: z.string().email().max(254),
    fullName: short,
    profile: profileSchema.nullable(),
    version: version.min(1),
    phoneVerification: z
      .object({
        status: z.enum(['UNVERIFIED', 'VERIFIED']),
        phoneE164: z.string().nullable(),
        verifiedAt: z.date().nullable(),
      })
      .strict(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export const orderStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'APPROVED',
  'ACTIVE',
  'DELIVERED',
  'CANCELLED',
]);
export const orderSchema = z
  .object({
    _id: id,
    customerId: id,
    version: version.min(1),
    purpose: z.enum(['NEW', 'RENEWAL']),
    packageCode,
    packageSnapshot: packageSchema,
    requirements: z.array(requirement),
    termsVersion: version.min(1),
    termsText: z.string().min(20).max(10000),
    profile: profileSchema,
    status: orderStatus,
    open: z.boolean(),
    managerId: id.nullable(),
    clientId: id.nullable(),
    tenantId: id.nullable(),
    subscriptionId: id.nullable(),
    parentOrderId: id.nullable(),
    reason: z.string().max(500).nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    approvedBy: id.nullable(),
    activatedBy: id.nullable(),
    deliveredAt: z.date().nullable(),
  })
  .strict();
export const documentSchema = z
  .object({
    _id: id,
    orderId: id,
    customerId: id,
    key,
    fileName: short,
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    size: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024),
    bytes: z.custom<Binary>((x) => x instanceof Binary),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    reason: z.string().nullable(),
    version: version.min(1),
    superseded: z.boolean(),
    uploadedAt: z.date(),
    reviewedAt: z.date().nullable(),
    reviewedBy: id.nullable(),
  })
  .strict();
export const invoiceSchema = z
  .object({
    _id: id,
    orderId: id,
    customerId: id,
    tenantId: id.nullable(),
    subscriptionId: id.nullable(),
    version: version.min(1),
    status: z.enum(['DRAFT', 'ISSUED', 'PAID', 'VOID']),
    number: z.string().nullable(),
    subtotalMinor: minor,
    taxMinor: minor,
    totalMinor: minor,
    currency: z.literal('SAR'),
    description: z.string().trim().min(3).max(500),
    dueDate: z.iso.date(),
    seller: sellerSchema.nullable(),
    createdBy: id,
    issuedBy: id.nullable(),
    transferId: id.nullable(),
    issuedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export const reviewSchema = z
  .object({
    _id: id,
    orderId: id,
    customerId: id,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000),
    createdAt: z.date(),
  })
  .strict();
export const registerSchema = z
  .object({
    ...command,
    fullName: short,
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
export const createOrderSchema = z
  .object({
    ...command,
    packageCode,
    parentOrderId: id.optional(),
  })
  .strict();
export const customerActionSchema = z
  .object({
    ...command,
    version,
    action: z.enum(['submit', 'cancel', 'acknowledge']),
    reason: reason.optional(),
    acceptedTermsVersion: version.optional(),
  })
  .strict();
export const adminActionSchema = z
  .object({
    ...command,
    version,
    action: z.enum(['assign', 'request_changes', 'reject', 'approve', 'activate']),
    reason,
    managerId: id.optional(),
    tenantId: id.optional(),
    subscriptionId: id.optional(),
  })
  .strict();
export type Account = z.infer<typeof accountSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogData = z.infer<typeof catalogDataSchema>;
export type CustomerDocument = z.infer<typeof documentSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export const WHATSAPP = { available: false, status: 'NOT_CONFIGURED' } as const;
export function defaultCatalog(): Catalog {
  return {
    _id: 'catalog',
    version: 0,
    liveVersion: 0,
    live: null,
    draft: {
      registrationOpen: true,
      ordersOpen: false,
      termsText: '',
      services: [],
      documents: [
        { key: 'commercial-register', label: 'السجل التجاري', required: true },
        { key: 'vat-certificate', label: 'وثيقة الرقم الضريبي', required: true },
        { key: 'clinic-logo', label: 'شعار العيادة', required: true },
      ],
      seller: null,
      packages: [
        {
          code: 'Lite' as const,
          description: '199 ر.س شهريًا. خصم سنوي ثابت 10% لكل سنة، غير تراكمي.',
          features: ['نظام العيادة', 'WhatsApp', 'بوت عبر WhatsApp'],
          planId: null,
          priceMinor: '19900',
          published: false,
        },
        {
          code: 'Pro' as const,
          description: '359 ر.س شهريًا. الخصم السنوي 15%.',
          features: ['الموقع/الرابط', 'WhatsApp', 'النظام الداخلي', 'كل المزايا الموجودة في النظام'],
          planId: null,
          priceMinor: '35900',
          published: false,
        },
        {
          code: 'Customize' as const,
          description: 'يُحدد النطاق والسعر بحسب الميزات المطلوبة بعد التواصل ومراجعة الاحتياج.',
          features: [],
          planId: null,
          priceMinor: null,
          published: false,
        },
      ],
    },
    updatedBy: null,
    updatedAt: null,
    publishedBy: null,
    publishedAt: null,
  };
}
