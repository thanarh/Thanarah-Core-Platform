import { z } from 'zod';

export const clinicWebsiteSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/u);

const uuidSchema = z.string().uuid();
const plainTextSchema = z.string().trim().max(2_000);

export const clinicWebsiteSectionSchema = z
  .object({
    id: uuidSchema,
    type: z.enum(['hero', 'richText', 'doctorList', 'serviceList', 'contact', 'booking']),
    content: z
      .object({
        heading: z.string().trim().max(120).optional(),
        text: plainTextSchema.optional(),
        buttonLabel: z.string().trim().max(60).optional(),
        phone: z.string().trim().max(40).optional(),
        email: z.string().trim().email().max(254).optional(),
      })
      .strict(),
    sourceIds: z.array(uuidSchema).max(100).default([]),
  })
  .strict();

export const clinicWebsitePageSchema = z
  .object({
    id: uuidSchema,
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/u),
    title: z.string().trim().min(1).max(80),
    visible: z.boolean(),
    sections: z.array(clinicWebsiteSectionSchema).max(25),
  })
  .strict();

export const clinicWebsiteDraftSchema = z
  .object({
    slug: clinicWebsiteSlugSchema,
    templateId: z.enum(['olive-care', 'clear-clinic', 'warm-practice']),
    brand: z
      .object({
        name: z.string().trim().min(1).max(100),
        tagline: z.string().trim().max(180),
        logoText: z.string().trim().max(4),
        primaryColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
        accentColor: z.string().regex(/^#[0-9a-f]{6}$/iu),
        fontFamily: z.enum(['system', 'arabic-sans', 'serif']),
      })
      .strict(),
    pages: z.array(clinicWebsitePageSchema).min(1).max(12),
  })
  .strict()
  .superRefine((draft, context) => {
    const pageIds = new Set<string>();
    const pageSlugs = new Set<string>();
    for (const [index, page] of draft.pages.entries()) {
      if (pageIds.has(page.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages', index, 'id'],
          message: 'Page identifiers must be unique',
        });
      }
      if (pageSlugs.has(page.slug)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages', index, 'slug'],
          message: 'Page slugs must be unique',
        });
      }
      pageIds.add(page.id);
      pageSlugs.add(page.slug);
      const sectionIds = new Set<string>();
      for (const [sectionIndex, section] of page.sections.entries()) {
        if (sectionIds.has(section.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['pages', index, 'sections', sectionIndex, 'id'],
            message: 'Section identifiers must be unique within a page',
          });
        }
        sectionIds.add(section.id);
      }
    }
    if (!pageSlugs.has('home')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages'],
        message: 'A home page is required',
      });
    }
  });

export const clinicWebsitePublishedSchema = z
  .object({
    version: z.number().int().nonnegative(),
    draft: clinicWebsiteDraftSchema,
    publishedAt: z.date(),
    publishedBy: uuidSchema,
  })
  .strict();

export const clinicWebsiteRecordSchema = z
  .object({
    _id: uuidSchema,
    tenantId: uuidSchema,
    version: z.number().int().nonnegative(),
    draft: clinicWebsiteDraftSchema,
    published: clinicWebsitePublishedSchema.nullable(),
    createdAt: z.date(),
    createdBy: uuidSchema,
    updatedAt: z.date(),
    updatedBy: uuidSchema,
  })
  .strict();

export const clinicWebsiteVersionSchema = z
  .object({
    _id: z.string().min(1).max(100),
    tenantId: uuidSchema,
    version: z.number().int().positive(),
    action: z.enum(['DRAFT_SAVED', 'PUBLISHED', 'RESTORED']),
    draft: clinicWebsiteDraftSchema,
    actorId: uuidSchema,
    createdAt: z.date(),
    restoredFromVersion: z.number().int().positive().nullable(),
  })
  .strict();

export type ClinicWebsiteSection = z.infer<typeof clinicWebsiteSectionSchema>;
export type ClinicWebsitePage = z.infer<typeof clinicWebsitePageSchema>;
export type ClinicWebsiteDraft = z.infer<typeof clinicWebsiteDraftSchema>;
export type ClinicWebsiteRecord = z.infer<typeof clinicWebsiteRecordSchema>;
export type ClinicWebsiteVersion = z.infer<typeof clinicWebsiteVersionSchema>;

export function defaultClinicWebsiteDraft(slug: string): ClinicWebsiteDraft {
  return {
    slug,
    templateId: 'olive-care',
    brand: {
      name: 'اسم العيادة',
      tagline: '',
      logoText: '',
      primaryColor: '#286557',
      accentColor: '#d4a756',
      fontFamily: 'arabic-sans',
    },
    pages: [
      {
        id: '4e3c75af-1c33-4f87-a365-994bc62e0d94',
        slug: 'home',
        title: 'الرئيسية',
        visible: true,
        sections: [
          {
            id: 'bd80f46d-a4eb-4e90-9c03-d063a573d2a4',
            type: 'hero',
            content: { heading: '', text: '', buttonLabel: '' },
            sourceIds: [],
          },
          {
            id: '846c2250-7881-41ce-a02c-f88a47f600e6',
            type: 'contact',
            content: { heading: 'تواصل مع العيادة', text: '', phone: '', email: '' },
            sourceIds: [],
          },
        ],
      },
    ],
  };
}
