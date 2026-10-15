import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { TenantAuthorizationService } from '../src/tenant/tenant-authorization.service';
import type { TenantMembershipRepository } from '../src/tenant/tenant-membership.repository';
import type {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from '../src/tenant/tenant-context.service';
import { TenantWorkspaceController } from '../src/tenant/tenant-workspace.controller';

const tenantId = '11111111-1111-4111-8111-111111111111';
const membershipId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

describe('TenantWorkspaceController', () => {
  it('returns only the authenticated user’s active tenant context and effective permissions', async () => {
    const memberships = {
      listActiveForPlatformUser: vi.fn().mockResolvedValue([
        {
          id: membershipId,
          tenantId,
          tenant: { displayName: 'Thanarah Clinic', slug: 'thanarah-clinic' },
        },
      ]),
    };
    const validatedMembership = { tenantId, membershipId, platformUserId: userId };
    const membershipValidator = {
      validateMembership: vi.fn().mockResolvedValue(validatedMembership),
    };
    const trustedContext = { tenantId, membershipId, platformUserId: userId };
    const tenantContextFactory = {
      fromValidatedMembership: vi.fn().mockReturnValue(trustedContext),
    };
    const authorization = {
      getEffectivePermissionCodes: vi
        .fn()
        .mockResolvedValue(['tenant.appointments.read', 'tenant.appointments.create']),
    };
    const controller = new TenantWorkspaceController(
      memberships as unknown as TenantMembershipRepository,
      membershipValidator as unknown as TenantMembershipValidatorService,
      tenantContextFactory as unknown as TrustedTenantContextFactoryService,
      authorization as unknown as TenantAuthorizationService,
    );
    const actor = {
      userId,
      sessionId: '44444444-4444-4444-8444-444444444444',
      tokenVersion: 1,
      platformRoleIds: [],
    } satisfies AuthenticatedPlatformUser;

    await expect(controller.list(actor)).resolves.toEqual({
      items: [
        {
          tenantId,
          displayName: 'Thanarah Clinic',
          slug: 'thanarah-clinic',
          membershipId,
          permissionCodes: ['tenant.appointments.read', 'tenant.appointments.create'],
        },
      ],
    });
    expect(memberships.listActiveForPlatformUser).toHaveBeenCalledWith(userId);
    expect(membershipValidator.validateMembership).toHaveBeenCalledWith({
      authenticatedPlatformUser: actor,
      tenantIdCandidate: tenantId,
    });
    expect(authorization.getEffectivePermissionCodes).toHaveBeenCalledWith(trustedContext);
  });
});
