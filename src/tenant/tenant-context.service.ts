import { Injectable } from '@nestjs/common';
import { TenantMembershipStatus, TenantStatus } from '@prisma/client';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { TenantMembershipRepository } from './tenant-membership.repository';
import { TenantRepository } from './tenant.repository';
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
    private readonly memberships: TenantMembershipRepository,
    private readonly tenants: TenantRepository,
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

    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
      throw new TenantContextInvalidError();
    }

    const membership = await this.memberships.findByTenantAndPlatformUser(
      tenantId,
      input.authenticatedPlatformUser.userId,
    );
    if (!membership || membership.status !== TenantMembershipStatus.ACTIVE) {
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
