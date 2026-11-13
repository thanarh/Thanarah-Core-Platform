import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  DoctorPersistencePort,
  DoctorRecord,
  DoctorListFilter,
  CreateDoctorInput,
  CreateDoctorResult,
  UpdateDoctorInput,
  DoctorMutationResult,
  DoctorStatusValue,
  DoctorServiceAssignmentInputRecord,
  DoctorServiceAssignmentRecord,
  DoctorServiceAssignmentMutationResult,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  documentTimestamps,
  newStableId,
  stableAssignmentId,
  departmentSchema,
  serviceCatalogSchema,
  tenantSchema,
} from './platform-mongo.models';
import type {
  DepartmentDocument,
  ServiceCatalogDocument,
  TenantDocument,
} from './platform-mongo.models';
import {
  MongoTenantAuthorizationContext as Context,
  parseMongoDocument,
} from './mongo-tenant-authorization.context';
import { mongoBranch, mongoFacility } from './mongo-tenant-scope.context';
import { staffScopeAssignmentSchema } from './mongo-tenant-staff-scope.repository';

const catalogAssignment = z.object({ targetId: z.string().uuid(), createdAt: z.date() }).strict();
const doctorSchema = z
  .object({
    _id: z.string().uuid(),
    tenantId: z.string().uuid(),
    staffId: z.string().uuid(),
    schemaVersion: z.literal(1),
    referenceVersion: z.number().int().nonnegative().optional(),
    professionalDisplayName: z.string().min(1).max(191).nullable(),
    professionalTitle: z.string().min(1).max(191).nullable(),
    professionalCode: z.string().min(1).max(64).nullable(),
    bio: z.string().min(1).max(2000).nullable(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    statusChangedAt: z.date(),
    suspendedAt: z.date().nullable(),
    deactivatedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    departmentAssignments: z.array(catalogAssignment),
    specialtyAssignments: z.array(catalogAssignment),
  })
  .strict();
const serviceAssignmentSchema = z
  .object({
    _id: z.string().min(1),
    tenantId: z.string().uuid(),
    doctorId: z.string().uuid(),
    serviceId: z.string().uuid(),
    facilityId: z.string().uuid(),
    branchId: z.string().uuid().nullable(),
    scopeType: z.enum(['FACILITY', 'BRANCH']),
    scopeId: z.string().uuid(),
    createdAt: z.date(),
  })
  .strict()
  .refine((row) =>
    row.scopeType === 'FACILITY'
      ? row.branchId === null && row.scopeId === row.facilityId
      : row.branchId === row.scopeId,
  );
type DoctorDocument = z.infer<typeof doctorSchema>;
type ServiceAssignment = z.infer<typeof serviceAssignmentSchema>;
type CatalogKind = 'departments' | 'specialties';
class DoctorWriteConflict extends PlatformDocumentConflictError {
  constructor(readonly kind: 'professional-code-conflict' | 'already-exists') {
    super();
  }
}

@Injectable()
export class MongoDoctorRepository implements DoctorPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async create(tenantId: string, input: CreateDoctorInput): Promise<CreateDoctorResult> {
    try {
      return await Context.run(this.manager, async (tx) => {
        if (!(await tx.activeTenant(tenantId, true))) return { kind: 'tenant-inactive' };
        const staff = await tx.staff(tenantId, input.staffId, true);
        if (!staff) return { kind: 'staff-not-found' };
        if (!(await tx.eligibleStaff(staff, true))) return { kind: 'staff-ineligible' };
        const departmentIds = input.departmentIds ?? [];
        const specialtyIds = input.specialtyIds ?? [];
        if (
          !(await this.catalogTargets(tx, tenantId, 'departments', departmentIds)) ||
          !(await this.catalogTargets(tx, tenantId, 'specialties', specialtyIds))
        )
          return { kind: 'assignment-target-not-found' };
        const now = new Date();
        const doctor = parseMongoDocument(doctorSchema, {
          _id: newStableId(),
          tenantId,
          staffId: staff._id,
          ...documentTimestamps(now),
          schemaVersion: 1,
          professionalDisplayName: input.professionalDisplayName ?? null,
          professionalTitle: input.professionalTitle ?? null,
          professionalCode: input.professionalCode ?? null,
          bio: input.bio ?? null,
          status: 'ACTIVE',
          statusChangedAt: now,
          suspendedAt: null,
          deactivatedAt: null,
          departmentAssignments: departmentIds.map((targetId) => ({ targetId, createdAt: now })),
          specialtyAssignments: specialtyIds.map((targetId) => ({ targetId, createdAt: now })),
        });
        try {
          await tx.db
            .collection<DoctorDocument>('doctors')
            .insertOne(doctor, { session: tx.session });
        } catch (error) {
          this.writeError(error);
        }
        return { kind: 'created', doctor: await this.record(tx, doctor) };
      });
    } catch (error) {
      if (error instanceof DoctorWriteConflict) return { kind: error.kind };
      throw error;
    }
  }

  listForTenant(tenantId: string, filter: DoctorListFilter): Promise<DoctorRecord[]> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId))) return [];
      const rows = await tx.db
        .collection<DoctorDocument>('doctors')
        .find(
          { tenantId, ...(filter.status ? { status: filter.status } : {}) },
          { session: tx.session },
        )
        .sort({ createdAt: -1, _id: -1 })
        .skip(filter.offset)
        .limit(filter.limit)
        .toArray();
      const records: DoctorRecord[] = [];
      for (const row of rows)
        records.push(await this.record(tx, parseMongoDocument(doctorSchema, row)));
      return records;
    });
  }

  findByIdForTenant(tenantId: string, id: string): Promise<DoctorRecord | null> {
    return Context.run(this.manager, async (tx) => {
      const row = await this.current(tx, tenantId, id);
      return row ? this.record(tx, row) : null;
    });
  }

  async updateForTenant(
    tenantId: string,
    id: string,
    input: UpdateDoctorInput,
  ): Promise<DoctorMutationResult> {
    try {
      return await Context.run(this.manager, async (tx) => {
        if (!(await tx.activeTenant(tenantId, true))) return { kind: 'tenant-inactive' };
        const current = await this.current(tx, tenantId, id, true);
        if (!current) return { kind: 'not-found' };
        const patch = Object.fromEntries(
          ['professionalDisplayName', 'professionalTitle', 'professionalCode', 'bio']
            .filter((key) => input[key as keyof UpdateDoctorInput] !== undefined)
            .map((key) => [key, input[key as keyof UpdateDoctorInput]]),
        );
        const updated = parseMongoDocument(doctorSchema, {
          ...current,
          ...patch,
          updatedAt: new Date(),
        });
        try {
          await tx.db
            .collection<DoctorDocument>('doctors')
            .replaceOne({ _id: id, tenantId }, updated, { session: tx.session });
        } catch (error) {
          this.writeError(error);
        }
        return { kind: 'changed', doctor: await this.record(tx, updated) };
      });
    } catch (error) {
      if (error instanceof DoctorWriteConflict && error.kind === 'professional-code-conflict')
        return { kind: error.kind };
      throw error;
    }
  }

  changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: DoctorStatusValue,
    nextStatus: DoctorStatusValue,
    changedAt: Date,
  ): Promise<DoctorMutationResult> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId, true))) return { kind: 'tenant-inactive' };
      const current = await this.current(tx, tenantId, id, true);
      if (!current || current.status !== expectedStatus) return { kind: 'not-changed' };
      const updated = parseMongoDocument(doctorSchema, {
        ...current,
        status: nextStatus,
        statusChangedAt: changedAt,
        updatedAt: changedAt,
        ...(nextStatus === 'SUSPENDED' ? { suspendedAt: changedAt } : {}),
        ...(nextStatus === 'DEACTIVATED' ? { deactivatedAt: changedAt } : {}),
      });
      await tx.db
        .collection<DoctorDocument>('doctors')
        .replaceOne({ _id: id, tenantId, status: expectedStatus }, updated, {
          session: tx.session,
        });
      return { kind: 'changed', doctor: await this.record(tx, updated) };
    });
  }

  assignDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<DoctorMutationResult> {
    return this.catalogAssignment(tenantId, doctorId, departmentId, 'departments', true);
  }
  unassignDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<DoctorMutationResult> {
    return this.catalogAssignment(tenantId, doctorId, departmentId, 'departments', false);
  }
  assignSpecialty(
    tenantId: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<DoctorMutationResult> {
    return this.catalogAssignment(tenantId, doctorId, specialtyId, 'specialties', true);
  }
  unassignSpecialty(
    tenantId: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<DoctorMutationResult> {
    return this.catalogAssignment(tenantId, doctorId, specialtyId, 'specialties', false);
  }

  listServiceAssignments(
    tenantId: string,
    doctorId: string,
  ): Promise<DoctorServiceAssignmentRecord[]> {
    return Context.run(this.manager, async (tx) => {
      const rows = await tx.db
        .collection<ServiceAssignment>('doctor_service_assignments')
        .find({ tenantId, doctorId }, { session: tx.session })
        .sort({ createdAt: 1, scopeType: 1, scopeId: 1 })
        .toArray();
      const records: DoctorServiceAssignmentRecord[] = [];
      for (const row of rows)
        records.push(
          await this.serviceRecord(tx, parseMongoDocument(serviceAssignmentSchema, row)),
        );
      return records;
    });
  }

  assignService(
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
  ): Promise<DoctorServiceAssignmentMutationResult> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId, true))) return { kind: 'tenant-inactive' };
      const doctor = await this.current(tx, tenantId, doctorId, true);
      const staff = doctor ? await tx.staff(tenantId, doctor.staffId, true) : null;
      if (!doctor || !staff) return { kind: 'doctor-not-found' };
      if (doctor.status === 'DEACTIVATED' || staff.status === 'DEACTIVATED')
        return { kind: 'doctor-deactivated' };
      if (!(await tx.touch('services', input.serviceId, { tenantId, status: 'ACTIVE' })))
        return { kind: 'target-not-found' };
      const facility = await mongoFacility(tx, tenantId, input.facilityId, true);
      if (!facility || facility.status !== 'ACTIVE') return { kind: 'target-not-found' };
      if (input.branchId) {
        const target = await mongoBranch(tx, tenantId, input.branchId, true);
        if (!target || target.branch.status !== 'ACTIVE' || target.facility._id !== facility._id)
          return { kind: 'target-not-found' };
      }
      const scope = await tx.db
        .collection<z.infer<typeof staffScopeAssignmentSchema>>('tenant_staff_scope_assignments')
        .findOne(
          {
            tenantId,
            staffId: staff._id,
            facilityId: input.facilityId,
            $or: [
              { scopeType: 'FACILITY', scopeId: input.facilityId },
              ...(input.branchId
                ? [{ scopeType: 'BRANCH' as const, scopeId: input.branchId }]
                : []),
            ],
          },
          { session: tx.session },
        );
      if (!scope) return { kind: 'doctor-out-of-scope' };
      parseMongoDocument(staffScopeAssignmentSchema, scope);
      const collection = tx.db.collection<ServiceAssignment>('doctor_service_assignments');
      const filter = this.serviceFilter(tenantId, doctorId, input);
      if (await collection.findOne(filter, { session: tx.session }))
        return { kind: 'assignment-conflict' };
      const row = parseMongoDocument(serviceAssignmentSchema, {
        ...filter,
        _id: `${filter.scopeType}:${stableAssignmentId(doctorId, input.serviceId, filter.scopeId)}`,
        createdAt: new Date(),
      });
      await collection.insertOne(row, { session: tx.session });
      return { kind: 'changed', assignment: await this.serviceRecord(tx, row) };
    });
  }

  unassignService(
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
  ): Promise<DoctorServiceAssignmentMutationResult> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId, true))) return { kind: 'tenant-inactive' };
      const collection = tx.db.collection<ServiceAssignment>('doctor_service_assignments');
      const row = await collection.findOne(this.serviceFilter(tenantId, doctorId, input), {
        session: tx.session,
      });
      if (!row) return { kind: 'assignment-not-found' };
      const assignment = await this.serviceRecord(
        tx,
        parseMongoDocument(serviceAssignmentSchema, row),
      );
      await collection.deleteOne({ _id: row._id, tenantId }, { session: tx.session });
      return { kind: 'changed', assignment };
    });
  }

  hasServiceAssignment(
    tenantId: string,
    doctorId: string,
    serviceId: string,
    facilityId: string,
    branchId: string | null,
  ): Promise<boolean> {
    return Context.run(
      this.manager,
      async (tx) =>
        !!(await tx.db.collection<ServiceAssignment>('doctor_service_assignments').findOne(
          {
            tenantId,
            doctorId,
            serviceId,
            facilityId,
            $or: [
              { scopeType: 'FACILITY', scopeId: facilityId },
              ...(branchId ? [{ scopeType: 'BRANCH' as const, scopeId: branchId }] : []),
            ],
          },
          { session: tx.session },
        )),
    );
  }

  private serviceFilter(
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
  ): Omit<ServiceAssignment, '_id' | 'createdAt'> {
    return {
      tenantId,
      doctorId,
      ...input,
      scopeType: input.branchId ? 'BRANCH' : 'FACILITY',
      scopeId: input.branchId ?? input.facilityId,
    };
  }

  private async current(
    tx: Context,
    tenantId: string,
    id: string,
    lock = false,
  ): Promise<DoctorDocument | null> {
    if (lock && !(await tx.touch('doctors', id, { tenantId }))) return null;
    const row = await tx.db
      .collection<DoctorDocument>('doctors')
      .findOne({ _id: id, tenantId }, { session: tx.session });
    return row ? parseMongoDocument(doctorSchema, row) : null;
  }

  private async catalogTargets(
    tx: Context,
    tenantId: string,
    kind: CatalogKind,
    ids: readonly string[],
  ): Promise<boolean> {
    if (new Set(ids).size !== ids.length) return false;
    for (const id of [...ids].sort())
      if (!(await tx.touch(kind, id, { tenantId, status: 'ACTIVE' }))) return false;
    return true;
  }

  private catalogAssignment(
    tenantId: string,
    doctorId: string,
    targetId: string,
    kind: CatalogKind,
    assign: boolean,
  ): Promise<DoctorMutationResult> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId, true))) return { kind: 'tenant-inactive' };
      const current = await this.current(tx, tenantId, doctorId, true);
      if (!current) return { kind: assign ? 'not-found' : 'assignment-not-found' };
      const key = kind === 'departments' ? 'departmentAssignments' : 'specialtyAssignments';
      if (assign) {
        if (current.status === 'DEACTIVATED') return { kind: 'doctor-deactivated' };
        if (!(await this.catalogTargets(tx, tenantId, kind, [targetId])))
          return { kind: 'assignment-target-not-found' };
        if (current[key].some((row) => row.targetId === targetId))
          return { kind: 'assignment-conflict' };
        current[key].push({ targetId, createdAt: new Date() });
      } else {
        if (!current[key].some((row) => row.targetId === targetId))
          return { kind: 'assignment-not-found' };
        current[key] = current[key].filter((row) => row.targetId !== targetId);
      }
      current.updatedAt = new Date();
      await tx.db
        .collection<DoctorDocument>('doctors')
        .replaceOne({ _id: doctorId, tenantId }, current, { session: tx.session });
      return { kind: 'changed', doctor: await this.record(tx, current) };
    });
  }

  private async record(tx: Context, row: DoctorDocument): Promise<DoctorRecord> {
    const staff = await tx.staff(row.tenantId, row.staffId);
    const tenantRow = await tx.db
      .collection<TenantDocument>('tenants')
      .findOne({ _id: row.tenantId }, { session: tx.session });
    if (!staff || !tenantRow) throw new PlatformMongoUnavailableError();
    const tenant = parseMongoDocument(tenantSchema, tenantRow);
    const departmentAssignments: DoctorRecord['departmentAssignments'] = [];
    const specialtyAssignments: DoctorRecord['specialtyAssignments'] = [];
    for (const assignment of row.departmentAssignments) {
      const target = await this.catalog(tx, row.tenantId, 'departments', assignment.targetId);
      departmentAssignments.push({ createdAt: assignment.createdAt, department: target });
    }
    for (const assignment of row.specialtyAssignments) {
      const target = await this.catalog(tx, row.tenantId, 'specialties', assignment.targetId);
      specialtyAssignments.push({ createdAt: assignment.createdAt, specialty: target });
    }
    return {
      id: row._id,
      tenantId: row.tenantId,
      staffId: row.staffId,
      professionalDisplayName: row.professionalDisplayName,
      professionalTitle: row.professionalTitle,
      professionalCode: row.professionalCode,
      bio: row.bio,
      status: row.status,
      statusChangedAt: row.statusChangedAt,
      suspendedAt: row.suspendedAt,
      deactivatedAt: row.deactivatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tenant: { status: tenant.status },
      staff: {
        id: staff._id,
        userId: staff.userId,
        displayName: staff.displayName,
        status: staff.status,
      },
      departmentAssignments,
      specialtyAssignments,
    };
  }

  private async catalog(
    tx: Context,
    tenantId: string,
    kind: CatalogKind,
    id: string,
  ): Promise<{ id: string; name: string; status: DepartmentDocument['status'] }> {
    const raw = await tx.db
      .collection<DepartmentDocument>(kind)
      .findOne({ _id: id, tenantId }, { session: tx.session });
    if (!raw) throw new PlatformMongoUnavailableError();
    const row = parseMongoDocument(departmentSchema, raw);
    return { id: row._id, name: row.name, status: row.status };
  }

  private async serviceRecord(
    tx: Context,
    row: ServiceAssignment,
  ): Promise<DoctorServiceAssignmentRecord> {
    const raw = await tx.db
      .collection<ServiceCatalogDocument>('services')
      .findOne({ _id: row.serviceId, tenantId: row.tenantId }, { session: tx.session });
    const facility = await mongoFacility(tx, row.tenantId, row.facilityId);
    const target = row.branchId ? await mongoBranch(tx, row.tenantId, row.branchId) : null;
    if (!raw || !facility || (row.branchId && (!target || target.facility._id !== facility._id)))
      throw new PlatformMongoUnavailableError();
    const service = parseMongoDocument(serviceCatalogSchema, raw);
    return {
      tenantId: row.tenantId,
      doctorId: row.doctorId,
      serviceId: row.serviceId,
      serviceName: service.name,
      serviceStatus: service.status,
      facilityId: facility._id,
      facilityName: facility.name,
      branchId: row.branchId,
      branchName: target?.branch.name ?? null,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      assignedAt: row.createdAt,
    };
  }

  private writeError(error: unknown): never {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      const professional =
        'keyPattern' in error &&
        typeof error.keyPattern === 'object' &&
        error.keyPattern !== null &&
        'professionalCode' in error.keyPattern;
      throw new DoctorWriteConflict(professional ? 'professional-code-conflict' : 'already-exists');
    }
    throw error;
  }
}
