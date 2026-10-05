/**
 * Membership lookup is a relationship-state check only. It does not
 * authenticate a caller, create TrustedTenantContext, or authorize tenant work.
 */
export interface TenantMembershipAccessQuery {
  readonly tenantId: string;
  readonly platformUserId: string;
}

export interface TenantMembershipAccessLookup {
  hasActiveMembership(query: TenantMembershipAccessQuery): Promise<boolean>;
}
