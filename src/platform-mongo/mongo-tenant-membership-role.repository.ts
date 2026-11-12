import { Injectable } from '@nestjs/common';
import type {
  TenantMembershipRolePersistencePort,
  TenantMembershipRoleAssignmentResult,
  TenantMembershipRoleRemovalResult,
  TenantMembershipRoleRecord,
} from '../persistence/platform-persistence.ports';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { PlatformMongoUnavailableError } from './platform-mongo.errors';
import { stableAssignmentId, tenantMembershipRoleSchema } from './platform-mongo.models';
import type {
  TenantMembershipRoleDocument,
  TenantMembershipDocument,
} from './platform-mongo.models';
import {
  MongoTenantAuthorizationContext as Context,
  parseMongoDocument,
} from './mongo-tenant-authorization.context';

@Injectable()
export class MongoTenantMembershipRoleRepository implements TenantMembershipRolePersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  resolvePermissionCodes(context: {
    tenantId: string;
    membershipId: string;
    platformUserId: string;
  }): Promise<string[]> {
    return Context.run(this.manager, async (tx) => {
      const codes = new Set<string>();
      for (const id of await tx.roleIds(
        context.tenantId,
        context.membershipId,
        context.platformUserId,
      )) {
        const role = await tx.role(context.tenantId, id);
        if (!role) throw new PlatformMongoUnavailableError();
        const record = await tx.roleRecord(role);
        for (const item of record.permissions) codes.add(item.permission.code);
      }
      return [...codes].sort();
    });
  }

  hasRoleCode(tenantId: string, membershipId: string, roleCode: string): Promise<boolean> {
    return Context.run(this.manager, (tx) => tx.hasRoleCode(tenantId, membershipId, roleCode));
  }

  listForMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<TenantMembershipRoleRecord[] | null> {
    return Context.run(this.manager, async (tx) => {
      if (
        !(await tx.db
          .collection<TenantMembershipDocument>('tenant_memberships')
          .findOne({ _id: membershipId, tenantId }, { session: tx.session }))
      )
        return null;
      const rows = await tx.db
        .collection<TenantMembershipRoleDocument>('tenant_membership_roles')
        .find({ tenantId, membershipId }, { session: tx.session })
        .sort({ assignedAt: 1, tenantRoleId: 1 })
        .toArray();
      const records: TenantMembershipRoleRecord[] = [];
      for (const row of rows) {
        const assignment = parseMongoDocument(tenantMembershipRoleSchema, row);
        const role = await tx.role(tenantId, assignment.tenantRoleId);
        if (!role) throw new PlatformMongoUnavailableError();
        records.push({ assignedAt: assignment.assignedAt, role: await tx.roleRecord(role) });
      }
      return records;
    });
  }

  assign(
    input: Parameters<TenantMembershipRolePersistencePort['assign']>[0],
  ): Promise<TenantMembershipRoleAssignmentResult> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(input.tenantId, true))) return { kind: 'not-found' };
      const actor = await tx.membership(
        input.tenantId,
        input.actorMembershipId,
        input.actorPlatformUserId,
        true,
      );
      const target = await tx.membership(input.tenantId, input.targetMembershipId, undefined, true);
      const role = await tx.role(input.tenantId, input.roleId, true);
      if (!actor || !target || !role) return { kind: 'not-found' };
      if (target.platformUserId.toLowerCase() === input.actorPlatformUserId.toLowerCase())
        return { kind: 'self-assignment' };
      if (
        role.code === 'OWNER' &&
        !(await tx.hasRoleCode(input.tenantId, input.actorMembershipId, 'OWNER', true))
      )
        return { kind: 'owner-only' };
      const id = stableAssignmentId(input.targetMembershipId, input.roleId);
      const collection = tx.db.collection<TenantMembershipRoleDocument>('tenant_membership_roles');
      const existing = await collection.findOne(
        { _id: id, tenantId: input.tenantId },
        { session: tx.session },
      );
      if (!existing)
        await collection.insertOne(
          parseMongoDocument(tenantMembershipRoleSchema, {
            _id: id,
            tenantId: input.tenantId,
            membershipId: target._id,
            tenantRoleId: role._id,
            assignedAt: new Date(),
          }),
          { session: tx.session },
        );
      return {
        kind: existing ? 'already-assigned' : 'changed',
        platformUserId: target.platformUserId,
        roleCode: role.code,
      };
    });
  }

  remove(
    input: Parameters<TenantMembershipRolePersistencePort['remove']>[0],
  ): Promise<TenantMembershipRoleRemovalResult> {
    return Context.run(this.manager, async (tx) => {
      if (!(await tx.activeTenant(input.tenantId, true))) return { kind: 'not-found' };
      // Removal permits historical/suspended memberships, matching the port.
      const target = await tx.db
        .collection<{ _id: string; tenantId: string; platformUserId: string }>('tenant_memberships')
        .findOne({ _id: input.membershipId, tenantId: input.tenantId }, { session: tx.session });
      const role = await tx.role(input.tenantId, input.roleId, true);
      if (!target || !role) return { kind: 'not-found' };
      if (role.code === 'OWNER') return { kind: 'owner-protected' };
      const removed = await tx.db
        .collection<TenantMembershipRoleDocument>('tenant_membership_roles')
        .deleteOne(
          { _id: stableAssignmentId(input.membershipId, input.roleId), tenantId: input.tenantId },
          { session: tx.session },
        );
      return removed.deletedCount === 1
        ? { kind: 'changed', platformUserId: target.platformUserId, roleCode: role.code }
        : { kind: 'not-assigned' };
    });
  }
}
