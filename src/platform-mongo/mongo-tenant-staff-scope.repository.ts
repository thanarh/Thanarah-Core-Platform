import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  TenantStaffScopePersistencePort,
  TenantStaffFacilityAssignmentRecord,
  TenantStaffBranchAssignmentRecord,
  TenantStaffEffectiveScope,
  AssignTenantStaffScopeResult,
  RemoveTenantStaffScopeResult,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { PlatformMongoUnavailableError } from './platform-mongo.errors';
import { stableAssignmentId, tenantStaffSchema } from './platform-mongo.models';
import type { TenantStaffDocument } from './platform-mongo.models';
import {
  MongoTenantAuthorizationContext as Context,
  parseMongoDocument,
} from './mongo-tenant-authorization.context';
import { mongoBranch, mongoFacility } from './mongo-tenant-scope.context';

export const staffScopeAssignmentSchema = z
  .object({
    _id: z.string().min(1),
    tenantId: z.string().uuid(),
    staffId: z.string().uuid(),
    facilityId: z.string().uuid(),
    branchId: z.string().uuid().nullable(),
    scopeType: z.enum(['FACILITY', 'BRANCH']),
    scopeId: z.string().uuid(),
    assignedAt: z.date(),
  })
  .strict()
  .refine((row) =>
    row.scopeType === 'FACILITY'
      ? row.branchId === null && row.scopeId === row.facilityId
      : row.branchId !== null && row.scopeId === row.branchId,
  );
type Assignment = z.infer<typeof staffScopeAssignmentSchema>;
type Input = {
  tenantId: string;
  actorMembershipId: string;
  actorPlatformUserId: string;
  staffId: string;
};
type Failure = { kind: 'not-found' | 'actor-ineligible' | 'staff-ineligible' };

@Injectable()
export class MongoTenantStaffScopeRepository implements TenantStaffScopePersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  listFacilitiesForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffFacilityAssignmentRecord[] | null> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId)) || !(await tx.staff(tenantId, staffId))) return null;
      const records: TenantStaffFacilityAssignmentRecord[] = [];
      for (const row of await this.assignments(tx, tenantId, staffId, 'FACILITY'))
        records.push(await this.facilityRecord(tx, row));
      return records;
    });
  }

  listBranchesForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffBranchAssignmentRecord[] | null> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId)) || !(await tx.staff(tenantId, staffId))) return null;
      const records: TenantStaffBranchAssignmentRecord[] = [];
      for (const row of await this.assignments(tx, tenantId, staffId, 'BRANCH'))
        records.push(await this.branchRecord(tx, row));
      return records;
    });
  }

  assignFacility(
    input: Input & { facilityId: string },
  ): Promise<AssignTenantStaffScopeResult<TenantStaffFacilityAssignmentRecord>> {
    return Context.run(this.manager, async (tx) => {
      const failure = await this.eligible(tx, input);
      if (failure) return failure;
      const facility = await mongoFacility(tx, input.tenantId, input.facilityId, true);
      if (!facility) return { kind: 'not-found' };
      if (facility.status !== 'ACTIVE') return { kind: 'unit-ineligible' };
      const result = await this.insert(tx, input, facility._id, null);
      return {
        kind: result.existing ? 'already-assigned' : 'changed',
        assignment: await this.facilityRecord(tx, result.row),
      };
    });
  }

  assignBranch(
    input: Input & { branchId: string },
  ): Promise<AssignTenantStaffScopeResult<TenantStaffBranchAssignmentRecord>> {
    return Context.run(this.manager, async (tx) => {
      const failure = await this.eligible(tx, input);
      if (failure) return failure;
      const target = await mongoBranch(tx, input.tenantId, input.branchId, true);
      if (!target) return { kind: 'not-found' };
      if (target.branch.status !== 'ACTIVE' || target.facility.status !== 'ACTIVE')
        return { kind: 'unit-ineligible' };
      const result = await this.insert(tx, input, target.facility._id, target.branch._id);
      return {
        kind: result.existing ? 'already-assigned' : 'changed',
        assignment: await this.branchRecord(tx, result.row),
      };
    });
  }

  removeFacility(input: Input & { facilityId: string }): Promise<RemoveTenantStaffScopeResult> {
    return this.remove(input, input.facilityId, 'FACILITY');
  }

  removeBranch(input: Input & { branchId: string }): Promise<RemoveTenantStaffScopeResult> {
    return this.remove(input, input.branchId, 'BRANCH');
  }

  resolveEffectiveScope(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffEffectiveScope | null> {
    return Context.run(this.manager, (tx) =>
      MongoTenantStaffScopeRepository.effectiveScope(tx, tenantId, staffId),
    );
  }

  resolveMembershipScope(
    tenantId: string,
    membershipId: string,
    platformUserId: string,
  ): Promise<TenantStaffEffectiveScope | null> {
    return Context.run(this.manager, async (tx) => {
      if (
        !(await tx.activeTenant(tenantId)) ||
        !(await tx.membership(tenantId, membershipId, platformUserId))
      )
        return { facilities: [], branches: [] };
      const row = await tx.db
        .collection<TenantStaffDocument>('tenant_staff')
        .findOne({ tenantId, membershipId, userId: platformUserId }, { session: tx.session });
      if (!row) return null;
      const staff = parseMongoDocument(tenantStaffSchema, row);
      return MongoTenantStaffScopeRepository.effectiveScope(tx, tenantId, staff._id);
    });
  }

  static async effectiveScope(
    tx: Context,
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffEffectiveScope | null> {
    if (!(await tx.activeTenant(tenantId))) return null;
    const staff = await tx.staff(tenantId, staffId);
    if (!staff) return null;
    const scope: {
      facilities: Array<{ id: string; name: string }>;
      branches: Array<{ id: string; name: string; facilityId: string; facilityName: string }>;
    } = { facilities: [], branches: [] };
    if (!(await tx.eligibleStaff(staff))) return scope;
    const rows = await tx.db
      .collection<Assignment>('tenant_staff_scope_assignments')
      .find({ tenantId, staffId }, { session: tx.session })
      .sort({ assignedAt: 1, scopeId: 1 })
      .toArray();
    for (const raw of rows) {
      const row = parseMongoDocument(staffScopeAssignmentSchema, raw);
      if (row.scopeType === 'FACILITY') {
        const facility = await mongoFacility(tx, tenantId, row.facilityId);
        if (facility?.status === 'ACTIVE')
          scope.facilities.push({ id: facility._id, name: facility.name });
      } else {
        const target = await mongoBranch(tx, tenantId, row.scopeId);
        if (
          target &&
          target.facility._id === row.facilityId &&
          target.branch.status === 'ACTIVE' &&
          target.facility.status === 'ACTIVE'
        ) {
          scope.branches.push({
            id: target.branch._id,
            name: target.branch.name,
            facilityId: target.facility._id,
            facilityName: target.facility.name,
          });
        }
      }
    }
    return scope;
  }

  private async eligible(tx: Context, input: Input): Promise<Failure | null> {
    if (!(await tx.activeTenant(input.tenantId, true))) return { kind: 'not-found' };
    if (
      !(await tx.membership(
        input.tenantId,
        input.actorMembershipId,
        input.actorPlatformUserId,
        true,
      ))
    )
      return { kind: 'actor-ineligible' };
    const staff = await tx.staff(input.tenantId, input.staffId, true);
    if (!staff) return { kind: 'not-found' };
    return (await tx.eligibleStaff(staff, true)) ? null : { kind: 'staff-ineligible' };
  }

  private async assignments(
    tx: Context,
    tenantId: string,
    staffId: string,
    scopeType: Assignment['scopeType'],
  ): Promise<Assignment[]> {
    const rows = await tx.db
      .collection<Assignment>('tenant_staff_scope_assignments')
      .find({ tenantId, staffId, scopeType }, { session: tx.session })
      .sort({ assignedAt: 1, scopeId: 1 })
      .toArray();
    return rows.map((row) => parseMongoDocument(staffScopeAssignmentSchema, row));
  }

  private async insert(
    tx: Context,
    input: Input,
    facilityId: string,
    branchId: string | null,
  ): Promise<{ existing: boolean; row: Assignment }> {
    const scopeType = branchId ? 'BRANCH' : 'FACILITY';
    const scopeId = branchId ?? facilityId;
    const collection = tx.db.collection<Assignment>('tenant_staff_scope_assignments');
    const _id = `${scopeType}:${stableAssignmentId(input.staffId, scopeId)}`;
    const existing = await collection.findOne(
      { _id, tenantId: input.tenantId },
      { session: tx.session },
    );
    const row =
      existing ??
      parseMongoDocument(staffScopeAssignmentSchema, {
        _id,
        tenantId: input.tenantId,
        staffId: input.staffId,
        facilityId,
        branchId,
        scopeType,
        scopeId,
        assignedAt: new Date(),
      });
    if (!existing) await collection.insertOne(row, { session: tx.session });
    return { existing: !!existing, row };
  }

  private remove(
    input: Input,
    scopeId: string,
    scopeType: Assignment['scopeType'],
  ): Promise<RemoveTenantStaffScopeResult> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(input.tenantId, true))) return { kind: 'not-found' };
      if (
        !(await tx.membership(
          input.tenantId,
          input.actorMembershipId,
          input.actorPlatformUserId,
          true,
        ))
      )
        return { kind: 'actor-ineligible' };
      const staff = await tx.staff(input.tenantId, input.staffId, true);
      const target =
        scopeType === 'FACILITY'
          ? await mongoFacility(tx, input.tenantId, scopeId, true)
          : await mongoBranch(tx, input.tenantId, scopeId, true);
      if (!staff || !target) return { kind: 'not-found' };
      const result = await tx.db.collection<Assignment>('tenant_staff_scope_assignments').deleteOne(
        {
          tenantId: input.tenantId,
          staffId: input.staffId,
          scopeType,
          scopeId,
        },
        { session: tx.session },
      );
      return result.deletedCount === 1
        ? { kind: 'changed', userId: staff.userId }
        : { kind: 'not-assigned' };
    });
  }

  private async facilityRecord(
    tx: Context,
    row: Assignment,
  ): Promise<TenantStaffFacilityAssignmentRecord> {
    const staff = await tx.staff(row.tenantId, row.staffId);
    const facility = await mongoFacility(tx, row.tenantId, row.facilityId);
    if (!staff || !facility) throw new PlatformMongoUnavailableError();
    return {
      staffId: row.staffId,
      facilityId: facility._id,
      assignedAt: row.assignedAt,
      staff: { userId: staff.userId },
      facility: { id: facility._id, name: facility.name, status: facility.status },
    };
  }

  private async branchRecord(
    tx: Context,
    row: Assignment,
  ): Promise<TenantStaffBranchAssignmentRecord> {
    const staff = await tx.staff(row.tenantId, row.staffId);
    const target = await mongoBranch(tx, row.tenantId, row.scopeId);
    if (!staff || !target || target.facility._id !== row.facilityId)
      throw new PlatformMongoUnavailableError();
    return {
      staffId: row.staffId,
      branchId: target.branch._id,
      facilityId: target.facility._id,
      assignedAt: row.assignedAt,
      staff: { userId: staff.userId },
      branch: { id: target.branch._id, name: target.branch.name, status: target.branch.status },
      facility: {
        id: target.facility._id,
        name: target.facility.name,
        status: target.facility.status,
      },
    };
  }
}
