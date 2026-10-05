import { HttpStatus } from '@nestjs/common';
import { PlatformAuditEventType, TenantMembershipStatus, TenantStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { PlatformAuditService } from '../src/platform-security/platform-audit.service';
import { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import {
  TenantContextInvalidError,
  type TrustedTenantContext,
} from '../src/tenant/tenant-context.contract';
import { TenantMembershipValidatorService } from '../src/tenant/tenant-context.service';
import type { TenantMembershipRepository } from '../src/tenant/tenant-membership.repository';
import type { TenantMembershipRoleRepository } from '../src/tenant/tenant-membership-role.repository';
import type { TenantRepository, TenantRecord } from '../src/tenant/tenant.repository';
import { TenantPermissionDeniedError } from '../src/tenant/tenant-authorization.errors';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const platformUserId = '33333333-3333-4333-8333-333333333333';
const context = {
  tenantId,
  membershipId,
  platformUserId,
} as unknown as TrustedTenantContext;
const authenticatedPlatformUser: AuthenticatedPlatformUser = {
  userId: platformUserId,
  sessionId: '44444444-4444-4444-8444-444444444444',
  tokenVersion: 1,
  platformRoleIds: [],
};

function tenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  const timestamp = new Date('2026-10-05T12:00:00.000Z');
  return {
    id: tenantId,
    slug: 'north-clinic',
    legalName: 'North Health Group',
    displayName: 'North Health Group',
    status: TenantStatus.ACTIVE,
    statusChangedAt: timestamp,
    suspendedAt: null,
    deactivatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('TenantMembershipValidatorService', () => {
  const memberships = { findByTenantAndPlatformUser: vi.fn() };
  const tenants = { findById: vi.fn() };
  let validator: TenantMembershipValidatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    memberships.findByTenantAndPlatformUser.mockResolvedValue({
      id: membershipId,
      tenantId,
      platformUserId,
      status: TenantMembershipStatus.ACTIVE,
    });
    tenants.findById.mockResolvedValue(tenant());
    validator = new TenantMembershipValidatorService(
      memberships as unknown as TenantMembershipRepository,
      tenants as unknown as TenantRepository,
    );
  });

  it('creates validated membership scope only for an active tenant/member pair', async () => {
    const validated = await validator.validateMembership({
      authenticatedPlatformUser,
      tenantIdCandidate: tenantId.toUpperCase(),
    });

    expect(validated).toEqual({ tenantId, membershipId, platformUserId });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(tenants.findById).toHaveBeenCalledWith(tenantId);
    expect(memberships.findByTenantAndPlatformUser).toHaveBeenCalledWith(tenantId, platformUserId);
  });

  it('fails closed for malformed, missing, inactive, or cross-tenant membership context', async () => {
    await expect(
      validator.validateMembership({
        authenticatedPlatformUser,
        tenantIdCandidate: 'not-a-tenant-id',
      }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(tenants.findById).not.toHaveBeenCalled();

    tenants.findById.mockResolvedValue(null);
    await expect(
      validator.validateMembership({ authenticatedPlatformUser, tenantIdCandidate: tenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(memberships.findByTenantAndPlatformUser).not.toHaveBeenCalled();

    tenants.findById.mockResolvedValue(tenant({ status: TenantStatus.SUSPENDED }));
    await expect(
      validator.validateMembership({ authenticatedPlatformUser, tenantIdCandidate: tenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    expect(memberships.findByTenantAndPlatformUser).not.toHaveBeenCalled();

    tenants.findById.mockResolvedValue(tenant());
    memberships.findByTenantAndPlatformUser.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: membershipId,
      tenantId,
      platformUserId,
      status: TenantMembershipStatus.SUSPENDED,
    });
    await expect(
      validator.validateMembership({ authenticatedPlatformUser, tenantIdCandidate: tenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
    await expect(
      validator.validateMembership({ authenticatedPlatformUser, tenantIdCandidate: tenantId }),
    ).rejects.toBeInstanceOf(TenantContextInvalidError);
  });
});

describe('TenantAuthorizationService', () => {
  const memberships = { resolvePermissionCodes: vi.fn() };
  const audit = { recordAudit: vi.fn() };
  let authorization: TenantAuthorizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    memberships.resolvePermissionCodes.mockResolvedValue(['tenant.roles.read']);
    audit.recordAudit.mockResolvedValue(undefined);
    authorization = new TenantAuthorizationService(
      memberships as unknown as TenantMembershipRoleRepository,
      audit as unknown as PlatformAuditService,
    );
  });

  it('resolves a tenant permission from active membership role assignments', async () => {
    await expect(authorization.authorize(context, 'tenant.roles.read')).resolves.toBeUndefined();
    expect(memberships.resolvePermissionCodes).toHaveBeenCalledWith(context);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('denies platform permissions and never consults platform authorization', async () => {
    await expect(authorization.authorize(context, 'platform.manage')).rejects.toBeInstanceOf(
      TenantPermissionDeniedError,
    );
    expect(memberships.resolvePermissionCodes).not.toHaveBeenCalled();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it('records a denied tenant permission with the trusted actor and tenant', async () => {
    await expect(authorization.authorize(context, 'tenant.roles.manage')).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(audit.recordAudit).toHaveBeenCalledWith({
      eventType: PlatformAuditEventType.TENANT_AUTHORIZATION_DENIED,
      actorUserId: platformUserId,
      subjectTenantId: tenantId,
      metadata: { permissionCode: 'tenant.roles.manage' },
    });
  });
});
