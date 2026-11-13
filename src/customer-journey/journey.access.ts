import { Injectable } from '@nestjs/common';
import {
  tenantSchema,
  subscriptionSchema,
  tenantMembershipSchema,
  tenantRoleSchema,
  tenantMembershipRoleSchema,
  platformPlanSchema,
} from '../platform-mongo/platform-mongo.models';
import {
  mongoStorageTargetSchema,
  storageTargetRecord,
} from '../platform-mongo/mongo-tenant-storage-registry.service';
import { TenantMongoClientManager } from '../tenant/tenant-mongo-client.manager';
import { MongoTenantAuthorizationContext } from '../platform-mongo/mongo-tenant-authorization.context';
import { fail } from '../internal-operations/operations.errors';
import { collection, stored, type JourneyTx } from './journey.store';
import type { Account, Order } from './journey.model';
import { canonical } from '../internal-operations/operations.store';
@Injectable()
export class JourneyAccess {
  constructor(readonly mongo: TenantMongoClientManager) {}
  async available(tx: JourneyTx, account: Account, order: Order, lock = false): Promise<boolean> {
    if (
      !account.profile ||
      canonical(account.profile) !== canonical(order.profile) ||
      account.phoneVerification.status !== 'VERIFIED' ||
      account.phoneVerification.phoneE164 !== order.profile.phoneE164 ||
      !account.phoneVerification.verifiedAt
    )
      return false;
    if (!order.tenantId || !order.subscriptionId) return false;
    const options = { session: tx.session };
    const tenant = await collection(tx, 'tenants').findOne({ _id: order.tenantId }, options);
    if (!tenant || stored(tenantSchema, tenant).status !== 'ACTIVE') return false;
    if (tenant.legalName !== order.profile.legalName) return false;
    const sub = await collection(tx, 'subscriptions').findOne(
      {
        _id: order.subscriptionId,
        tenantId: order.tenantId,
      },
      options,
    );
    if (!sub) return false;
    const subscription = stored(subscriptionSchema, sub),
      now = new Date();
    if (
      subscription.status !== 'ACTIVE' ||
      subscription.startsAt > now ||
      (subscription.endsAt && subscription.endsAt <= now)
    )
      return false;
    const plan = await collection(tx, 'platform_plans').findOne(
      { _id: subscription.planId },
      options,
    );
    if (!plan || stored(platformPlanSchema, plan).status !== 'ACTIVE') return false;
    if (order.packageSnapshot.planId) {
      if (subscription.planId !== order.packageSnapshot.planId) return false;
    } else if (order.packageCode !== 'Customize') return false;
    const memberships = await collection(tx, 'tenant_memberships')
      .find(
        {
          tenantId: order.tenantId,
          platformUserId: account.userId,
          status: 'ACTIVE',
        },
        options,
      )
      .limit(2)
      .toArray();
    if (memberships.length !== 1) return false;
    const membership = stored(tenantMembershipSchema, memberships[0]);
    const ownerRole = await collection(tx, 'tenant_roles').findOne(
      {
        tenantId: order.tenantId,
        code: 'OWNER',
        isSystemRole: true,
      },
      options,
    );
    if (!ownerRole) return false;
    const owner = stored(tenantRoleSchema, ownerRole);
    const assignment = await collection(tx, 'tenant_membership_roles').findOne(
      {
        tenantId: order.tenantId,
        membershipId: membership._id,
        tenantRoleId: owner._id,
      },
      options,
    );
    if (!assignment) return false;
    stored(tenantMembershipRoleSchema, assignment);
    const targets = await collection(tx, 'tenant_storage_targets')
      .find(
        {
          tenantId: order.tenantId,
          provider: 'MONGODB',
          status: 'ACTIVE',
          isPrimary: true,
        },
        options,
      )
      .limit(2)
      .toArray();
    if (targets.length !== 1) return false;
    const target = stored(mongoStorageTargetSchema, targets[0]);
    if (lock) {
      const context = new MongoTenantAuthorizationContext(tx.db, tx.session);
      // Use the owning documents' reference protocol, never feature-specific fields.
      for (const [name, id] of [
        ['tenants', tenant._id],
        ['subscriptions', sub._id],
        ['platform_plans', plan._id],
        ['tenant_memberships', membership._id],
        ['tenant_roles', owner._id],
      ])
        if (!(await context.touch(name, id))) return false;
      // Storage target owning schema is strict; serialize through its tenant parent.
      const db = await this.mongo.getDatabase(storageTargetRecord(target));
      try {
        await db.command({ ping: 1 });
      } catch {
        fail('CUSTOMER_TENANT_STORAGE_UNAVAILABLE', 'تخزين حساب المنشأة غير متاح.', 503);
      }
    }
    return true;
  }
}
