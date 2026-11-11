import { describe, expect, it } from 'vitest';
import { REQUIRED_PERMISSIONS_KEY } from '../src/auth/auth.constants';
import { SubscriptionController } from '../src/subscriptions/subscription.controller';
import { TenantSubscriptionPortalController } from '../src/tenant/tenant-subscription-portal.controller';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_PERMISSION_CODES,
} from '../src/tenant/tenant-authorization.constants';
import { TENANT_REQUIRED_PERMISSIONS } from '../src/tenant/tenant-require-permissions.decorator';

describe('tenant subscription portal permissions', () => {
  it('grants portal permissions only to tenant owners and admins by default', () => {
    expect(TENANT_PERMISSION_CODES).toContain('tenant.subscriptions.read');
    expect(TENANT_PERMISSION_CODES).toContain('tenant.subscriptions.payments.submit');
    const owner = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'OWNER');
    const admin = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'ADMIN');
    const member = DEFAULT_TENANT_ROLES.find(({ code }) => code === 'MEMBER');
    for (const code of ['tenant.subscriptions.read', 'tenant.subscriptions.payments.submit']) {
      expect(owner?.permissionCodes).toContain(code);
      expect(admin?.permissionCodes).toContain(code);
      expect(member?.permissionCodes).not.toContain(code);
    }
  });

  it('keeps clinic reads and submissions separate from platform review permissions', () => {
    expect(
      Reflect.getMetadata(
        TENANT_REQUIRED_PERMISSIONS,
        TenantSubscriptionPortalController.prototype.getPortal,
      ),
    ).toEqual(['tenant.subscriptions.read']);
    expect(
      Reflect.getMetadata(
        TENANT_REQUIRED_PERMISSIONS,
        TenantSubscriptionPortalController.prototype.submitTransfer,
      ),
    ).toEqual(['tenant.subscriptions.read', 'tenant.subscriptions.payments.submit']);
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, SubscriptionController.prototype.listTransfers),
    ).toEqual(['subscriptions.read']);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        SubscriptionController.prototype.approveTransfer,
      ),
    ).toEqual(['subscriptions.manage']);
  });
});
