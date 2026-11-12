import { Injectable } from '@nestjs/common';
import type {
  TenantStaffRolePersistencePort,
  TenantStaffRoleAssignmentRecord,
  AssignTenantStaffRoleResult,
  RemoveTenantStaffRoleResult,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { PlatformMongoUnavailableError } from './platform-mongo.errors';
import { stableAssignmentId, tenantStaffRoleSchema } from './platform-mongo.models';
import type { TenantStaffRoleDocument } from './platform-mongo.models';
import {
  MongoTenantAuthorizationContext as Context,
  parseMongoDocument,
} from './mongo-tenant-authorization.context';

@Injectable()
export class MongoTenantStaffRoleRepository implements TenantStaffRolePersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  listForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffRoleAssignmentRecord[] | null> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(tenantId)) || !(await tx.staff(tenantId, staffId))) return null;
      const rows = await tx.db
        .collection<TenantStaffRoleDocument>('tenant_staff_roles')
        .find({ tenantId, staffId }, { session: tx.session })
        .sort({ assignedAt: 1, tenantRoleId: 1 })
        .toArray();
      const records: TenantStaffRoleAssignmentRecord[] = [];
      for (const row of rows) records.push(await this.record(tx, row));
      return records;
    });
  }

  assign(
    input: Parameters<TenantStaffRolePersistencePort['assign']>[0],
  ): Promise<AssignTenantStaffRoleResult> {
    return Context.run(this.manager, async (tx) => {
      if (
        !(await tx.activeTenant(input.tenantId, true)) ||
        !(await tx.membership(
          input.tenantId,
          input.actorMembershipId,
          input.actorPlatformUserId,
          true,
        ))
      )
        return { kind: 'not-found' };
      const staff = await tx.staff(input.tenantId, input.staffId, true);
      if (!staff) return { kind: 'not-found' };
      if (!(await tx.eligibleStaff(staff, true))) return { kind: 'staff-ineligible' };
      if (staff.userId.toLowerCase() === input.actorPlatformUserId.toLowerCase())
        return { kind: 'self-assignment' };
      const role = await tx.role(input.tenantId, input.roleId, true);
      if (!role) return { kind: 'not-found' };
      if (
        role.code === 'OWNER' &&
        !(await tx.hasRoleCode(input.tenantId, input.actorMembershipId, 'OWNER', true))
      )
        return { kind: 'owner-only' };
      const collection = tx.db.collection<TenantStaffRoleDocument>('tenant_staff_roles');
      const id = stableAssignmentId(input.staffId, input.roleId);
      const existing = await collection.findOne(
        { _id: id, tenantId: input.tenantId },
        { session: tx.session },
      );
      const assignment =
        existing ??
        parseMongoDocument(tenantStaffRoleSchema, {
          _id: id,
          tenantId: input.tenantId,
          staffId: input.staffId,
          tenantRoleId: input.roleId,
          assignedAt: new Date(),
        });
      if (!existing) await collection.insertOne(assignment, { session: tx.session });
      return {
        kind: existing ? 'already-assigned' : 'changed',
        assignment: await this.record(tx, assignment),
      };
    });
  }

  remove(
    input: Parameters<TenantStaffRolePersistencePort['remove']>[0],
  ): Promise<RemoveTenantStaffRoleResult> {
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
      const role = await tx.role(input.tenantId, input.roleId, true);
      if (!staff || !role) return { kind: 'not-found' };
      if (role.code === 'OWNER') return { kind: 'owner-protected' };
      const result = await tx.db
        .collection<TenantStaffRoleDocument>('tenant_staff_roles')
        .deleteOne(
          {
            _id: stableAssignmentId(input.staffId, input.roleId),
            tenantId: input.tenantId,
          },
          { session: tx.session },
        );
      return result.deletedCount === 1
        ? { kind: 'changed', userId: staff.userId, roleCode: role.code }
        : { kind: 'not-assigned' };
    });
  }

  private async record(
    tx: Context,
    row: TenantStaffRoleDocument,
  ): Promise<TenantStaffRoleAssignmentRecord> {
    const assignment = parseMongoDocument(tenantStaffRoleSchema, row);
    const staff = await tx.staff(assignment.tenantId, assignment.staffId);
    const role = await tx.role(assignment.tenantId, assignment.tenantRoleId);
    if (!staff || !role) throw new PlatformMongoUnavailableError();
    return {
      tenantId: assignment.tenantId,
      staffId: staff._id,
      tenantRoleId: role._id,
      assignedAt: assignment.assignedAt,
      staff: { userId: staff.userId },
      role: {
        id: role._id,
        code: role.code,
        name: role.name,
        description: role.description,
        isSystemRole: role.isSystemRole,
      },
    };
  }
}
