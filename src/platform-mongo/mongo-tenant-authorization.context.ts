import type { ClientSession, Db, Document, TransactionOptions } from 'mongodb';
import type { z } from 'zod';
import type { TenantRoleRecord } from '../persistence/platform-persistence.ports';
import type { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import {
  tenantMembershipSchema,
  tenantRoleSchema,
  tenantStaffSchema,
  tenantPermissionSchema,
  tenantRolePermissionSchema,
  tenantMembershipRoleSchema,
  tenantStaffRoleSchema,
} from './platform-mongo.models';
import type {
  TenantMembershipDocument,
  TenantRoleDocument,
  TenantStaffDocument,
} from './platform-mongo.models';

const OPTIONS: TransactionOptions = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
  readPreference: 'primary',
};

export function parseMongoDocument<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new PlatformDocumentValidationError();
  return parsed.data;
}

/** Every read in an authorization decision shares this transaction/session. */
export class MongoTenantAuthorizationContext {
  constructor(
    readonly db: Db,
    readonly session: ClientSession,
  ) {}

  static async run<T>(
    manager: PlatformMongoClientManager,
    operation: (context: MongoTenantAuthorizationContext) => Promise<T>,
  ): Promise<T> {
    return manager.withTransaction(
      async (session) =>
        operation(new MongoTenantAuthorizationContext(await manager.getDatabase(), session)),
      OPTIONS,
    );
  }

  /**
   * Write the actual reference document, not an adapter-private lock. Any
   * concurrent status change/delete on that document must conflict or precede
   * this transaction. Never use an unchanged $set as a substitute for this write.
   */
  async touch(collection: string, id: string, filter: Document = {}): Promise<boolean> {
    const result = await this.db
      .collection<Document & { _id: string }>(collection)
      .updateOne(
        { ...filter, _id: id },
        { $inc: { referenceVersion: 1 } },
        { session: this.session },
      );
    return result.matchedCount === 1;
  }

  async activeTenant(tenantId: string, lock = false): Promise<boolean> {
    if (lock) return this.touch('tenants', tenantId, { status: 'ACTIVE' });
    return !!(await this.db
      .collection<Document & { _id: string }>('tenants')
      .findOne({ _id: tenantId, status: 'ACTIVE' }, { session: this.session }));
  }

  async membership(
    tenantId: string,
    id: string,
    userId?: string,
    lock = false,
  ): Promise<TenantMembershipDocument | null> {
    const filter = { tenantId, status: 'ACTIVE', ...(userId ? { platformUserId: userId } : {}) };
    if (lock && !(await this.touch('tenant_memberships', id, filter))) return null;
    const row = await this.db
      .collection<Document & { _id: string }>('tenant_memberships')
      .findOne({ _id: id, ...filter }, { session: this.session });
    return row ? parseMongoDocument(tenantMembershipSchema, row) : null;
  }

  async staff(tenantId: string, id: string, lock = false): Promise<TenantStaffDocument | null> {
    if (lock && !(await this.touch('tenant_staff', id, { tenantId }))) return null;
    const row = await this.db
      .collection<Document & { _id: string }>('tenant_staff')
      .findOne({ _id: id, tenantId }, { session: this.session });
    return row ? parseMongoDocument(tenantStaffSchema, row) : null;
  }

  async eligibleStaff(staff: TenantStaffDocument, lock = false): Promise<boolean> {
    if (
      staff.status !== 'ACTIVE' ||
      !(await this.membership(staff.tenantId, staff.membershipId, staff.userId, lock))
    )
      return false;
    if (lock) return this.touch('platform_users', staff.userId, { status: 'ACTIVE' });
    return !!(await this.db
      .collection<Document & { _id: string }>('platform_users')
      .findOne({ _id: staff.userId, status: 'ACTIVE' }, { session: this.session }));
  }

  async role(tenantId: string, id: string, lock = false): Promise<TenantRoleDocument | null> {
    if (lock && !(await this.touch('tenant_roles', id, { tenantId }))) return null;
    const row = await this.db
      .collection<Document & { _id: string }>('tenant_roles')
      .findOne({ _id: id, tenantId }, { session: this.session });
    return row ? parseMongoDocument(tenantRoleSchema, row) : null;
  }

  async roleRecord(role: TenantRoleDocument): Promise<TenantRoleRecord> {
    const joins = await this.db
      .collection('tenant_role_permissions')
      .find({ tenantRoleId: role._id }, { session: this.session })
      .toArray();
    const permissions: TenantRoleRecord['permissions'] = [];
    for (const row of joins) {
      const join = parseMongoDocument(tenantRolePermissionSchema, row);
      const permission = await this.db
        .collection<Document & { _id: string }>('tenant_permissions')
        .findOne({ _id: join.tenantPermissionId }, { session: this.session });
      if (!permission) throw new PlatformMongoUnavailableError();
      const parsed = parseMongoDocument(tenantPermissionSchema, permission);
      permissions.push({ permission: { code: parsed.code } });
    }
    permissions.sort((a, b) => a.permission.code.localeCompare(b.permission.code));
    return {
      id: role._id,
      tenantId: role.tenantId,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystemRole: role.isSystemRole,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissions,
    };
  }

  async roleIds(tenantId: string, membershipId: string, userId?: string): Promise<string[]> {
    const membership = await this.membership(tenantId, membershipId, userId);
    if (!membership || !(await this.activeTenant(tenantId))) return [];
    const staffRow = await this.db
      .collection<Document & { _id: string }>('tenant_staff')
      .findOne({ tenantId, membershipId }, { session: this.session });
    const staff = staffRow ? parseMongoDocument(tenantStaffSchema, staffRow) : null;
    if (staff && staff.userId !== membership.platformUserId) {
      throw new PlatformMongoUnavailableError();
    }
    if (staff && staff.status !== 'ACTIVE') return [];
    const roleIds: string[] = [];
    const membershipRoles = await this.db
      .collection('tenant_membership_roles')
      .find({ tenantId, membershipId }, { session: this.session })
      .toArray();
    for (const row of membershipRoles)
      roleIds.push(parseMongoDocument(tenantMembershipRoleSchema, row).tenantRoleId);
    if (staff) {
      const staffRoles = await this.db
        .collection('tenant_staff_roles')
        .find({ tenantId, staffId: staff._id }, { session: this.session })
        .toArray();
      for (const row of staffRoles)
        roleIds.push(parseMongoDocument(tenantStaffRoleSchema, row).tenantRoleId);
    }
    return [...new Set(roleIds)];
  }

  async hasRoleCode(
    tenantId: string,
    membershipId: string,
    code: string,
    lock = false,
  ): Promise<boolean> {
    // OWNER eligibility checks use both membership and active staff assignments.
    // Unlike permission resolution, an inactive staff profile does not remove
    // an independently held membership role.
    const membership = await this.membership(tenantId, membershipId);
    if (!(await this.activeTenant(tenantId)) || !membership) return false;
    const roles = await this.db
      .collection<Document & { _id: string }>('tenant_roles')
      .find({ tenantId, code }, { session: this.session })
      .toArray();
    for (const role of roles) {
      if (
        await this.db
          .collection('tenant_membership_roles')
          .findOne({ tenantId, membershipId, tenantRoleId: role._id }, { session: this.session })
      )
        return true;
      const staff = await this.db
        .collection<Document & { _id: string }>('tenant_staff')
        .findOne(
          { tenantId, membershipId, userId: membership.platformUserId, status: 'ACTIVE' },
          { session: this.session },
        );
      if (
        staff &&
        lock &&
        !(await this.touch('tenant_staff', staff._id, { tenantId, status: 'ACTIVE' }))
      )
        continue;
      if (
        staff &&
        (await this.db
          .collection('tenant_staff_roles')
          .findOne(
            { tenantId, staffId: staff._id, tenantRoleId: role._id },
            { session: this.session },
          ))
      )
        return true;
    }
    return false;
  }
}
