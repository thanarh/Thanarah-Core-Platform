import { describe, expectTypeOf, it } from 'vitest';
import type {
  TenantMembershipAccessLookup,
  TenantMembershipAccessQuery,
} from '../src/tenant/tenant-membership-access.contract';

type AssertFalse<T extends false> = T;

type _TenantIdAloneIsNotMembershipEvidence = AssertFalse<
  { readonly tenantId: string } extends TenantMembershipAccessQuery ? true : false
>;
type _PlatformUserIdAloneIsNotMembershipEvidence = AssertFalse<
  { readonly platformUserId: string } extends TenantMembershipAccessQuery ? true : false
>;
type _MembershipLookupDoesNotAuthorizeTenantWork = AssertFalse<
  'authorize' extends keyof TenantMembershipAccessLookup ? true : false
>;

const membershipContractAssertions: [
  _TenantIdAloneIsNotMembershipEvidence,
  _PlatformUserIdAloneIsNotMembershipEvidence,
  _MembershipLookupDoesNotAuthorizeTenantWork,
] = [false, false, false];
void membershipContractAssertions;

function verifyMembershipLookupContract(
  lookup: TenantMembershipAccessLookup,
  query: TenantMembershipAccessQuery,
): void {
  void lookup.hasActiveMembership(query);

  // @ts-expect-error A tenant selector alone cannot establish membership.
  void lookup.hasActiveMembership({ tenantId: query.tenantId });

  // @ts-expect-error The lookup requires both relationship endpoints.
  void lookup.hasActiveMembership(query.tenantId);
}
void verifyMembershipLookupContract;

describe('tenant membership access contract', () => {
  it('requires both tenant and platform-user identity without exposing authorization', () => {
    expectTypeOf<{ tenantId: string }>().not.toMatchTypeOf<TenantMembershipAccessQuery>();
    expectTypeOf<{ platformUserId: string }>().not.toMatchTypeOf<TenantMembershipAccessQuery>();
    expectTypeOf<TenantMembershipAccessLookup>().not.toHaveProperty('authorize');
  });
});
