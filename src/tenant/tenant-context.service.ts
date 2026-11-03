import { Inject, Injectable } from '@nestjs/common';
import { TenantMembershipStatus } from '@prisma/client';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import {
  TENANT_MEMBERSHIP_PERSISTENCE,
  type TenantMembershipPersistencePort,
} from '../persistence/platform-persistence.ports';
import {
  TenantContextInvalidError,
  type TenantMembershipValidator,
  type TrustedTenantContext,
  type TrustedTenantContextFactory,
  type ValidatedTenantMembership,
  type TenantId,
  type TenantMembershipId,
} from './tenant-context.contract';

@Injectable()
export class TenantMembershipValidatorService implements TenantMembershipValidator {
  constructor(
    @Inject(TENANT_MEMBERSHIP_PERSISTENCE)
    private readonly memberships: TenantMembershipPersistencePort,
  ) {}

  async validateMembership(input: {
    readonly authenticatedPlatformUser: AuthenticatedPlatformUser;
    readonly tenantIdCandidate: string;
  }): Promise<ValidatedTenantMembership> {
    const tenantId = input.tenantIdCandidate.toLowerCase();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)
    ) {
      throw new TenantContextInvalidError();
    }

    const authenticatedPlatformUserId = input.authenticatedPlatformUser.userId;
    const membership = await this.memberships.findActiveForTenantAndPlatformUser(
      tenantId,
      authenticatedPlatformUserId,
    );
    if (
      !membership ||
      membership.tenantId.toLowerCase() !== tenantId ||
      membership.platformUserId.toLowerCase() !== authenticatedPlatformUserId.toLowerCase() ||
      membership.status !== TenantMembershipStatus.ACTIVE
    ) {
      throw new TenantContextInvalidError();
    }

    return Object.freeze({
      tenantId: tenantId as TenantId,
      membershipId: membership.id as TenantMembershipId,
      platformUserId: membership.platformUserId,
    }) as ValidatedTenantMembership;
  }
}

@Injectable()
export class TrustedTenantContextFactoryService implements TrustedTenantContextFactory {
  fromValidatedMembership(membership: ValidatedTenantMembership): TrustedTenantContext {
    return Object.freeze({
      tenantId: membership.tenantId,
      membershipId: membership.membershipId,
      platformUserId: membership.platformUserId,
    }) as TrustedTenantContext;
  }
}
