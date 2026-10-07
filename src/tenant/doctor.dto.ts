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
    departmentIds: uniqueUuidList.optional(),
    specialtyIds: uniqueUuidList.optional(),
  })
  .strict();

export const updateDoctorSchema = z
  .object({
    professionalDisplayName: professionalDisplayNameSchema.nullable().optional(),
  })
  .strict()
  .refine(({ professionalDisplayName }) => professionalDisplayName !== undefined);

export const listDoctorsQuerySchema = z
  .object({
    status: z.nativeEnum(StaffStatus).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const doctorDepartmentAssignmentSchema = z.object({ departmentId: uuid }).strict();

export const doctorSpecialtyAssignmentSchema = z.object({ specialtyId: uuid }).strict();

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type ListDoctorsQuery = z.infer<typeof listDoctorsQuerySchema>;
export type DoctorDepartmentAssignmentInput = z.infer<typeof doctorDepartmentAssignmentSchema>;
export type DoctorSpecialtyAssignmentInput = z.infer<typeof doctorSpecialtyAssignmentSchema>;
