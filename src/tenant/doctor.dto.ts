import { StaffStatus } from '@prisma/client';
import { z } from 'zod';

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

const professionalDisplayNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(191));

const professionalTitleSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(191));

const professionalCodeSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' '))
  .pipe(z.string().min(1).max(64));

const professionalBioSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').replace(/\r\n?/gu, '\n').trim())
  .pipe(z.string().min(1).max(2000))
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), {
    message: 'Biography must contain plain text, not HTML markup',
  });

const uniqueUuidList = z
  .array(uuid)
  .max(100)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate identifiers are not allowed',
      });
    }
  });

export const doctorIdSchema = uuid;

export const createDoctorSchema = z
  .object({
    staffId: uuid,
    professionalDisplayName: professionalDisplayNameSchema.optional(),
    professionalTitle: professionalTitleSchema.optional(),
    professionalCode: professionalCodeSchema.optional(),
    bio: professionalBioSchema.optional(),
    departmentIds: uniqueUuidList.optional(),
    specialtyIds: uniqueUuidList.optional(),
  })
  .strict();

export const updateDoctorSchema = z
  .object({
    professionalDisplayName: professionalDisplayNameSchema.nullable().optional(),
    professionalTitle: professionalTitleSchema.nullable().optional(),
    professionalCode: professionalCodeSchema.nullable().optional(),
    bio: professionalBioSchema.nullable().optional(),
  })
  .strict()
  .refine((profile) => Object.values(profile).some((value) => value !== undefined));

export const listDoctorsQuerySchema = z
  .object({
    status: z.nativeEnum(StaffStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const doctorDepartmentAssignmentSchema = z.object({ departmentId: uuid }).strict();

export const doctorSpecialtyAssignmentSchema = z.object({ specialtyId: uuid }).strict();

export const doctorServiceAssignmentSchema = z
  .object({
    serviceId: uuid,
    facilityId: uuid,
    branchId: uuid.optional().nullable(),
  })
  .strict()
  .transform((input) => ({ ...input, branchId: input.branchId ?? null }));

export const doctorServiceAssignmentLocationSchema = z
  .object({
    facilityId: uuid,
    branchId: uuid.optional().nullable(),
  })
  .strict()
  .transform((input) => ({ ...input, branchId: input.branchId ?? null }));

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type ListDoctorsQuery = z.infer<typeof listDoctorsQuerySchema>;
export type DoctorDepartmentAssignmentInput = z.infer<typeof doctorDepartmentAssignmentSchema>;
export type DoctorSpecialtyAssignmentInput = z.infer<typeof doctorSpecialtyAssignmentSchema>;
export type DoctorServiceAssignmentInput = z.infer<typeof doctorServiceAssignmentSchema>;
export type DoctorServiceAssignmentLocation = z.infer<typeof doctorServiceAssignmentLocationSchema>;
