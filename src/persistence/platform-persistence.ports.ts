import type { PlanFeatureQuotaLimits } from '../platform-catalog/plan-feature-quota';
import type { TenantPermissionCode } from '../tenant/tenant-authorization.constants';
import type { SchedulingPolicyRules } from '../tenant/appointment-scheduling-policy.dto';

export const FEATURE_PERSISTENCE = Symbol('FEATURE_PERSISTENCE');
export const PLAN_PERSISTENCE = Symbol('PLAN_PERSISTENCE');
export const PLATFORM_AUDIT_PERSISTENCE = Symbol('PLATFORM_AUDIT_PERSISTENCE');
export const PLATFORM_USER_PERSISTENCE = Symbol('PLATFORM_USER_PERSISTENCE');
export const PLATFORM_SESSION_PERSISTENCE = Symbol('PLATFORM_SESSION_PERSISTENCE');
export const PLATFORM_AUTHORIZATION_PERSISTENCE = Symbol('PLATFORM_AUTHORIZATION_PERSISTENCE');
export const TENANT_PERSISTENCE = Symbol('TENANT_PERSISTENCE');
export const TENANT_MEMBERSHIP_PERSISTENCE = Symbol('TENANT_MEMBERSHIP_PERSISTENCE');
export const TENANT_ROLE_PERSISTENCE = Symbol('TENANT_ROLE_PERSISTENCE');
export const TENANT_MEMBERSHIP_ROLE_PERSISTENCE = Symbol('TENANT_MEMBERSHIP_ROLE_PERSISTENCE');
export const FACILITY_PERSISTENCE = Symbol('FACILITY_PERSISTENCE');
export const BRANCH_PERSISTENCE = Symbol('BRANCH_PERSISTENCE');
export const TENANT_ENTITLEMENT_PERSISTENCE = Symbol('TENANT_ENTITLEMENT_PERSISTENCE');
export const TENANT_QUOTA_PERSISTENCE = Symbol('TENANT_QUOTA_PERSISTENCE');
export const SUBSCRIPTION_PERSISTENCE = Symbol('SUBSCRIPTION_PERSISTENCE');
export const HEALTHCARE_CATALOG_PERSISTENCE = Symbol('HEALTHCARE_CATALOG_PERSISTENCE');
export const SERVICE_CATALOG_PERSISTENCE = Symbol('SERVICE_CATALOG_PERSISTENCE');
export const TENANT_STAFF_PERSISTENCE = Symbol('TENANT_STAFF_PERSISTENCE');
export const TENANT_STAFF_ROLE_PERSISTENCE = Symbol('TENANT_STAFF_ROLE_PERSISTENCE');
export const TENANT_STAFF_SCOPE_PERSISTENCE = Symbol('TENANT_STAFF_SCOPE_PERSISTENCE');
export const FACILITY_SCHEDULING_POLICY_PERSISTENCE = Symbol(
  'FACILITY_SCHEDULING_POLICY_PERSISTENCE',
);
export const DOCTOR_PERSISTENCE = Symbol('DOCTOR_PERSISTENCE');

export type TenantStatusValue = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type TenantMembershipStatusValue = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface TenantRecord {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  status: TenantStatusValue;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantListFilter {
  status?: TenantStatusValue;
  limit: number;
  offset: number;
}

export interface TenantPersistencePort {
  create(input: { slug: string; legalName: string; displayName: string }): Promise<TenantRecord>;
  findById(id: string): Promise<TenantRecord | null>;
  findBySlug(slug: string): Promise<TenantRecord | null>;
  list(filter: TenantListFilter): Promise<TenantRecord[]>;
  changeStatusIfCurrent(
    id: string,
    expectedStatus: TenantStatusValue,
    nextStatus: TenantStatusValue,
    changedAt: Date,
  ): Promise<TenantRecord | null>;
}

export interface TenantMembershipRecord {
  id: string;
  tenantId: string;
  platformUserId: string;
  status: TenantMembershipStatusValue;
  statusChangedAt: Date;
  activatedAt: Date | null;
  suspendedAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMembershipDirectoryRecord {
  id: string;
  tenantId: string;
  platformUserId: string;
  status: TenantMembershipStatusValue;
  statusChangedAt: Date;
  createdAt: Date;
  platformUser: { fullName: string; status: PlatformUserStatusValue };
}

export interface TenantWorkspaceMembershipRecord {
  id: string;
  tenantId: string;
  tenant: { displayName: string; slug: string };
}

export interface TenantMembershipListFilter {
  tenantId: string;
  status?: TenantMembershipStatusValue;
  limit: number;
  offset: number;
}

export type TenantMembershipStatusChangeResult =
  | { kind: 'updated'; membership: TenantMembershipRecord }
  | { kind: 'stale' }
  | { kind: 'owner-protected' };

export interface TenantMembershipPersistencePort {
  create(input: { tenantId: string; platformUserId: string }): Promise<TenantMembershipRecord>;
  findByTenantAndPlatformUser(
    tenantId: string,
    platformUserId: string,
  ): Promise<TenantMembershipRecord | null>;
  findActiveForTenantAndPlatformUser(
    tenantId: string,
    platformUserId: string,
  ): Promise<TenantMembershipRecord | null>;
  listActiveForPlatformUser(platformUserId: string): Promise<TenantWorkspaceMembershipRecord[]>;
  findByIdForTenant(id: string, tenantId: string): Promise<TenantMembershipRecord | null>;
  listForTenant(filter: TenantMembershipListFilter): Promise<TenantMembershipRecord[]>;
  listDirectoryForTenant(
    filter: TenantMembershipListFilter,
  ): Promise<TenantMembershipDirectoryRecord[]>;
  changeStatusIfCurrent(
    id: string,
    tenantId: string,
    expectedStatus: TenantMembershipStatusValue,
    nextStatus: TenantMembershipStatusValue,
    changedAt: Date,
  ): Promise<TenantMembershipStatusChangeResult>;
  hasActiveMembership(tenantId: string, platformUserId: string): Promise<boolean>;
}

export interface TenantRoleRecord {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{ permission: { code: string } }>;
}

export interface TenantRoleBootstrapResult {
  ownerMembershipId: string;
  roles: TenantRoleRecord[];
  createdRoleCodes: string[];
  updatedPermissionRoleCodes: string[];
}

export type TenantMembershipRoleAssignmentResult =
  | { kind: 'changed'; platformUserId: string; roleCode: string }
  | { kind: 'already-assigned'; platformUserId: string; roleCode: string }
  | { kind: 'not-found' }
  | { kind: 'self-assignment' }
  | { kind: 'owner-only' };

export type TenantMembershipRoleRemovalResult =
  | { kind: 'changed'; platformUserId: string; roleCode: string }
  | { kind: 'not-found' }
  | { kind: 'owner-protected' }
  | { kind: 'not-assigned' };

export interface TenantMembershipRoleRecord {
  assignedAt: Date;
  role: TenantRoleRecord;
}

export interface TenantRolePersistencePort {
  create(input: {
    tenantId: string;
    code: string;
    name: string;
    description?: string | null;
  }): Promise<TenantRoleRecord>;
  findByIdForTenant(tenantId: string, id: string): Promise<TenantRoleRecord | null>;
  listForTenant(tenantId: string): Promise<TenantRoleRecord[]>;
  updateMetadata(
    tenantId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<TenantRoleRecord | null>;
  replacePermissions(
    tenantId: string,
    roleId: string,
    permissionCodes: readonly TenantPermissionCode[],
  ): Promise<TenantRoleRecord | null>;
  bootstrapInitialOwner(input: {
    tenantId: string;
    platformUserId: string;
  }): Promise<TenantRoleBootstrapResult>;
}

export interface TenantMembershipRolePersistencePort {
  resolvePermissionCodes(context: {
    tenantId: string;
    membershipId: string;
    platformUserId: string;
  }): Promise<string[]>;
  hasRoleCode(tenantId: string, membershipId: string, roleCode: string): Promise<boolean>;
  listForMembership(
    tenantId: string,
    membershipId: string,
  ): Promise<TenantMembershipRoleRecord[] | null>;
  assign(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    targetMembershipId: string;
    roleId: string;
  }): Promise<TenantMembershipRoleAssignmentResult>;
  remove(input: {
    tenantId: string;
    membershipId: string;
    roleId: string;
  }): Promise<TenantMembershipRoleRemovalResult>;
}

export type FacilityStatusValue = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type BranchStatusValue = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface FacilityRecord {
  id: string;
  tenantId: string;
  name: string;
  status: FacilityStatusValue;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacilityListFilter {
  status?: FacilityStatusValue;
  limit: number;
  offset: number;
}

export interface FacilityPersistencePort {
  create(tenantId: string, input: { name: string }): Promise<FacilityRecord>;
  findById(tenantId: string, id: string): Promise<FacilityRecord | null>;
  listForTenant(tenantId: string, filter: FacilityListFilter): Promise<FacilityRecord[]>;
  updateName(tenantId: string, id: string, name: string): Promise<FacilityRecord | null>;
  changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: FacilityStatusValue,
    nextStatus: FacilityStatusValue,
    changedAt: Date,
  ): Promise<FacilityRecord | null>;
}

export interface BranchRecord {
  id: string;
  facilityId: string;
  name: string;
  status: BranchStatusValue;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchFacilityScope {
  id: string;
  status: FacilityStatusValue;
  tenant: { status: TenantStatusValue };
}

export interface BranchListFilter {
  status?: BranchStatusValue;
  limit: number;
  offset: number;
}

export interface BranchPersistencePort {
  findFacilityScope(tenantId: string, facilityId: string): Promise<BranchFacilityScope | null>;
  createUnderActiveFacility(
    tenantId: string,
    facilityId: string,
    input: { name: string },
  ): Promise<BranchRecord | null>;
  listForFacility(
    tenantId: string,
    facilityId: string,
    filter: BranchListFilter,
  ): Promise<BranchRecord[]>;
  findByIdWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
  ): Promise<BranchRecord | null>;
  updateNameWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
    name: string,
  ): Promise<BranchRecord | null>;
  changeStatusIfCurrentWithinFacility(
    tenantId: string,
    facilityId: string,
    branchId: string,
    expectedStatus: BranchStatusValue,
    nextStatus: BranchStatusValue,
    changedAt: Date,
  ): Promise<BranchRecord | null>;
}

export type PlanFeatureEntitlementLookup =
  | { kind: 'plan-not-found' }
  | { kind: 'plan-unavailable' }
  | { kind: 'feature-not-found' }
  | { kind: 'feature-unavailable' }
  | { kind: 'plan-feature-missing' }
  | { kind: 'plan-feature-disabled' }
  | { kind: 'plan-feature-ambiguous' }
  | { kind: 'entitled'; featureId: string };

export interface TenantEntitlementPersistencePort {
  resolveFeatureOnPlan(planId: string, featureKey: string): Promise<PlanFeatureEntitlementLookup>;
}

export type TenantQuotaPlanFeatureLookup =
  { kind: 'unavailable' } | { kind: 'ready'; quotaLimits: unknown };

export interface TenantQuotaPersistencePort {
  findActivePlanFeatureQuotaLimits(
    planId: string,
    featureId: string,
  ): Promise<TenantQuotaPlanFeatureLookup>;
}

export type SubscriptionStatusValue = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
export type SubscriptionLifecycleActionValue = 'activate' | 'suspend' | 'cancel' | 'expire';

export interface SubscriptionRecord {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatusValue;
  startsAt: Date;
  endsAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionListFilter {
  tenantId?: string;
  status?: SubscriptionStatusValue;
  limit: number;
  offset: number;
}

export interface CreateSubscriptionRecordInput {
  tenantId: string;
  planId: string;
  status: SubscriptionStatusValue;
  startsAt: Date;
  endsAt: Date | null;
}

export type CreateSubscriptionResult =
  | { kind: 'created'; subscription: SubscriptionRecord }
  | { kind: 'tenant-not-found' }
  | { kind: 'tenant-unavailable' }
  | { kind: 'plan-not-found' }
  | { kind: 'plan-unavailable' }
  | { kind: 'period-conflict' };

export type TransitionSubscriptionResult =
  | {
      kind: 'updated';
      subscription: SubscriptionRecord;
      previousStatus: SubscriptionStatusValue;
    }
  | { kind: 'not-found' }
  | { kind: 'tenant-unavailable' }
  | { kind: 'period-conflict' }
  | { kind: 'transition-invalid' };

export interface SubscriptionPersistencePort {
  findById(id: string): Promise<SubscriptionRecord | null>;
  list(filter: SubscriptionListFilter): Promise<SubscriptionRecord[]>;
  findCurrentForTenant(tenantId: string, asOf: Date): Promise<SubscriptionRecord[]>;
  createForActiveTenantAndPlan(
    input: CreateSubscriptionRecordInput,
  ): Promise<CreateSubscriptionResult>;
  transition(
    id: string,
    action: SubscriptionLifecycleActionValue,
    now: Date,
  ): Promise<TransitionSubscriptionResult>;
}

export type TenantCatalogStatusValue = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface HealthcareCatalogRecord {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: TenantCatalogStatusValue;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type HealthcareCatalogKindValue = 'department' | 'specialty';
export interface HealthcareCatalogListFilter {
  status?: TenantCatalogStatusValue;
  limit: number;
  offset: number;
}

export type HealthcareCatalogMutationResult =
  | { kind: 'changed'; record: HealthcareCatalogRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'not-found' }
  | { kind: 'name-conflict' }
  | { kind: 'not-changed' };

export interface HealthcareCatalogPersistencePort {
  create(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    input: { name: string; description?: string | null },
  ): Promise<HealthcareCatalogMutationResult>;
  findById(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    id: string,
  ): Promise<HealthcareCatalogRecord | null>;
  list(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    query: HealthcareCatalogListFilter,
  ): Promise<HealthcareCatalogRecord[]>;
  update(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    id: string,
    input: { name?: string; description?: string | null },
  ): Promise<HealthcareCatalogMutationResult>;
  changeStatusIfCurrent(
    kind: HealthcareCatalogKindValue,
    tenantId: string,
    id: string,
    expectedStatus: TenantCatalogStatusValue,
    nextStatus: TenantCatalogStatusValue,
    changedAt: Date,
  ): Promise<HealthcareCatalogMutationResult>;
}

export interface ServiceCatalogRecord {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  status: TenantCatalogStatusValue;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceCatalogListFilter {
  status?: TenantCatalogStatusValue;
  limit: number;
  offset: number;
}

export type ServiceCatalogMutationResult =
  | { kind: 'changed'; record: ServiceCatalogRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'not-found' }
  | { kind: 'name-conflict' }
  | { kind: 'code-conflict' }
  | { kind: 'conflict' }
  | { kind: 'not-changed' };

export interface ServiceCatalogPersistencePort {
  create(
    tenantId: string,
    input: { name: string; code?: string; description?: string | null },
  ): Promise<ServiceCatalogMutationResult>;
  findById(tenantId: string, id: string): Promise<ServiceCatalogRecord | null>;
  list(
    tenantId: string,
    query: ServiceCatalogListFilter,
  ): Promise<{ items: ServiceCatalogRecord[]; total: number }>;
  update(
    tenantId: string,
    id: string,
    input: { name?: string; code?: string | null; description?: string | null },
  ): Promise<ServiceCatalogMutationResult>;
  changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: TenantCatalogStatusValue,
    nextStatus: TenantCatalogStatusValue,
    changedAt: Date,
  ): Promise<ServiceCatalogMutationResult>;
}

export type StaffStatusValue = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface TenantStaffRecord {
  id: string;
  tenantId: string;
  userId: string;
  membershipId: string;
  displayName: string;
  jobTitle: string | null;
  status: StaffStatusValue;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantStaffListFilter {
  status?: StaffStatusValue;
  limit: number;
  offset: number;
}

export type CreateTenantStaffResult =
  | { kind: 'created'; staff: TenantStaffRecord }
  | { kind: 'membership-ineligible' }
  | { kind: 'tenant-unavailable' }
  | { kind: 'already-exists' };

export interface TenantStaffPersistencePort {
  createForActiveMembership(
    tenantId: string,
    membershipId: string,
    input: { displayName?: string; jobTitle?: string },
  ): Promise<CreateTenantStaffResult>;
  listForTenant(tenantId: string, filter: TenantStaffListFilter): Promise<TenantStaffRecord[]>;
  findByIdForTenant(tenantId: string, id: string): Promise<TenantStaffRecord | null>;
  updateForTenant(
    tenantId: string,
    id: string,
    input: { displayName?: string; jobTitle?: string | null },
  ): Promise<TenantStaffRecord | null>;
  changeStatusIfCurrentForTenant(
    tenantId: string,
    id: string,
    expectedStatus: StaffStatusValue,
    nextStatus: StaffStatusValue,
    changedAt: Date,
  ): Promise<TenantStaffRecord | null>;
}

export interface TenantStaffRoleAssignmentRecord {
  tenantId: string;
  staffId: string;
  tenantRoleId: string;
  assignedAt: Date;
  staff: { userId: string };
  role: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    isSystemRole: boolean;
  };
}

export type AssignTenantStaffRoleResult =
  | { kind: 'changed'; assignment: TenantStaffRoleAssignmentRecord }
  | { kind: 'already-assigned'; assignment: TenantStaffRoleAssignmentRecord }
  | { kind: 'not-found' }
  | { kind: 'staff-ineligible' }
  | { kind: 'self-assignment' }
  | { kind: 'owner-only' };

export type RemoveTenantStaffRoleResult =
  | { kind: 'changed'; userId: string; roleCode: string }
  | { kind: 'not-found' }
  | { kind: 'actor-ineligible' }
  | { kind: 'owner-protected' }
  | { kind: 'not-assigned' };

export interface TenantStaffRolePersistencePort {
  listForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffRoleAssignmentRecord[] | null>;
  assign(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    roleId: string;
  }): Promise<AssignTenantStaffRoleResult>;
  remove(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    roleId: string;
  }): Promise<RemoveTenantStaffRoleResult>;
}

export interface TenantStaffFacilityAssignmentRecord {
  staffId: string;
  facilityId: string;
  assignedAt: Date;
  staff: { userId: string };
  facility: { id: string; name: string; status: FacilityStatusValue };
}

export interface TenantStaffBranchAssignmentRecord {
  staffId: string;
  branchId: string;
  facilityId: string;
  assignedAt: Date;
  staff: { userId: string };
  branch: { id: string; name: string; status: BranchStatusValue };
  facility: { id: string; name: string; status: FacilityStatusValue };
}

export interface TenantStaffEffectiveScope {
  facilities: ReadonlyArray<{ id: string; name: string }>;
  branches: ReadonlyArray<{
    id: string;
    name: string;
    facilityId: string;
    facilityName: string;
  }>;
}

export type AssignTenantStaffScopeResult<T> =
  | { kind: 'changed'; assignment: T }
  | { kind: 'already-assigned'; assignment: T }
  | { kind: 'not-found' }
  | { kind: 'actor-ineligible' }
  | { kind: 'staff-ineligible' }
  | { kind: 'unit-ineligible' };

export type RemoveTenantStaffScopeResult =
  | { kind: 'changed'; userId: string }
  | { kind: 'not-found' }
  | { kind: 'actor-ineligible' }
  | { kind: 'not-assigned' };

export interface TenantStaffScopePersistencePort {
  listFacilitiesForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffFacilityAssignmentRecord[] | null>;
  listBranchesForStaff(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffBranchAssignmentRecord[] | null>;
  assignFacility(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    facilityId: string;
  }): Promise<AssignTenantStaffScopeResult<TenantStaffFacilityAssignmentRecord>>;
  assignBranch(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    branchId: string;
  }): Promise<AssignTenantStaffScopeResult<TenantStaffBranchAssignmentRecord>>;
  removeFacility(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    facilityId: string;
  }): Promise<RemoveTenantStaffScopeResult>;
  removeBranch(input: {
    tenantId: string;
    actorMembershipId: string;
    actorPlatformUserId: string;
    staffId: string;
    branchId: string;
  }): Promise<RemoveTenantStaffScopeResult>;
  resolveEffectiveScope(
    tenantId: string,
    staffId: string,
  ): Promise<TenantStaffEffectiveScope | null>;
  resolveMembershipScope(
    tenantId: string,
    membershipId: string,
    platformUserId: string,
  ): Promise<TenantStaffEffectiveScope | null>;
}

export type FacilitySchedulingPolicyStatusValue = 'ACTIVE' | 'INACTIVE';
export type FacilitySchedulingPolicyRevisionActionValue =
  'CREATED' | 'UPDATED' | 'ACTIVATED' | 'DEACTIVATED';

export interface FacilitySchedulingPolicyRecord {
  id: string;
  tenantId: string;
  facilityId: string;
  status: FacilitySchedulingPolicyStatusValue;
  timeZone: string;
  rules: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FacilitySchedulingPolicyRevisionRecord {
  id: string;
  policyId: string;
  tenantId: string;
  facilityId: string;
  version: number;
  action: FacilitySchedulingPolicyRevisionActionValue;
  status: FacilitySchedulingPolicyStatusValue;
  timeZone: string;
  rules: unknown;
  actorUserId: string;
  createdAt: Date;
}

export interface FacilitySchedulingPolicyPersistencePort {
  findByFacility(
    tenantId: string,
    facilityId: string,
  ): Promise<FacilitySchedulingPolicyRecord | null>;
  findActiveByFacility(
    tenantId: string,
    facilityId: string,
  ): Promise<FacilitySchedulingPolicyRecord | null>;
  findActiveTimeZonesByFacilities(
    tenantId: string,
    facilityIds: string[],
  ): Promise<Array<{ facilityId: string; timeZone: string }>>;
  upsert(input: {
    tenantId: string;
    facilityId: string;
    expectedVersion?: number;
    timeZone: string;
    rules: SchedulingPolicyRules;
    actorUserId: string;
  }): Promise<{ policy: FacilitySchedulingPolicyRecord; changed: boolean }>;
  setStatus(input: {
    tenantId: string;
    facilityId: string;
    expectedVersion: number;
    status: FacilitySchedulingPolicyStatusValue;
    actorUserId: string;
  }): Promise<{ policy: FacilitySchedulingPolicyRecord | null; changed: boolean }>;
  listRevisions(
    tenantId: string,
    facilityId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FacilitySchedulingPolicyRevisionRecord[]; total: number }>;
}

export type DoctorStatusValue = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface DoctorRecord {
  id: string;
  tenantId: string;
  staffId: string;
  professionalDisplayName: string | null;
  professionalTitle: string | null;
  professionalCode: string | null;
  bio: string | null;
  status: DoctorStatusValue;
  statusChangedAt: Date;
  suspendedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tenant: { status: TenantStatusValue };
  staff: {
    id: string;
    userId: string;
    displayName: string;
    status: DoctorStatusValue;
  };
  departmentAssignments: Array<{
    createdAt: Date;
    department: { id: string; name: string; status: TenantCatalogStatusValue };
  }>;
  specialtyAssignments: Array<{
    createdAt: Date;
    specialty: { id: string; name: string; status: TenantCatalogStatusValue };
  }>;
}

export interface DoctorServiceAssignmentRecord {
  tenantId: string;
  doctorId: string;
  serviceId: string;
  serviceName: string;
  serviceStatus: TenantCatalogStatusValue;
  facilityId: string;
  facilityName: string;
  branchId: string | null;
  branchName: string | null;
  scopeType: 'FACILITY' | 'BRANCH';
  scopeId: string;
  assignedAt: Date;
}

export interface DoctorServiceAssignmentInputRecord {
  serviceId: string;
  facilityId: string;
  branchId: string | null;
}

export type DoctorServiceAssignmentMutationResult =
  | { kind: 'changed'; assignment: DoctorServiceAssignmentRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'doctor-not-found' }
  | { kind: 'doctor-deactivated' }
  | { kind: 'target-not-found' }
  | { kind: 'doctor-out-of-scope' }
  | { kind: 'assignment-conflict' }
  | { kind: 'assignment-not-found' };

export interface DoctorListFilter {
  status?: DoctorStatusValue;
  limit: number;
  offset: number;
}

export interface CreateDoctorInput {
  staffId: string;
  professionalDisplayName?: string;
  professionalTitle?: string;
  professionalCode?: string;
  bio?: string;
  departmentIds?: string[];
  specialtyIds?: string[];
}

export interface UpdateDoctorInput {
  professionalDisplayName?: string | null;
  professionalTitle?: string | null;
  professionalCode?: string | null;
  bio?: string | null;
}

export type CreateDoctorResult =
  | { kind: 'created'; doctor: DoctorRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'staff-not-found' }
  | { kind: 'staff-ineligible' }
  | { kind: 'assignment-target-not-found' }
  | { kind: 'professional-code-conflict' }
  | { kind: 'already-exists' };

export type DoctorMutationResult =
  | { kind: 'changed'; doctor: DoctorRecord }
  | { kind: 'tenant-inactive' }
  | { kind: 'not-found' }
  | { kind: 'not-changed' }
  | { kind: 'doctor-deactivated' }
  | { kind: 'professional-code-conflict' }
  | { kind: 'assignment-target-not-found' }
  | { kind: 'assignment-conflict' }
  | { kind: 'assignment-not-found' };

export interface DoctorPersistencePort {
  create(tenantId: string, input: CreateDoctorInput): Promise<CreateDoctorResult>;
  listForTenant(tenantId: string, filter: DoctorListFilter): Promise<DoctorRecord[]>;
  findByIdForTenant(tenantId: string, id: string): Promise<DoctorRecord | null>;
  updateForTenant(
    tenantId: string,
    id: string,
    input: UpdateDoctorInput,
  ): Promise<DoctorMutationResult>;
  changeStatusIfCurrent(
    tenantId: string,
    id: string,
    expectedStatus: DoctorStatusValue,
    nextStatus: DoctorStatusValue,
    changedAt: Date,
  ): Promise<DoctorMutationResult>;
  assignDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<DoctorMutationResult>;
  unassignDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<DoctorMutationResult>;
  assignSpecialty(
    tenantId: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<DoctorMutationResult>;
  unassignSpecialty(
    tenantId: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<DoctorMutationResult>;
  listServiceAssignments(
    tenantId: string,
    doctorId: string,
  ): Promise<DoctorServiceAssignmentRecord[]>;
  assignService(
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
  ): Promise<DoctorServiceAssignmentMutationResult>;
  unassignService(
    tenantId: string,
    doctorId: string,
    input: DoctorServiceAssignmentInputRecord,
  ): Promise<DoctorServiceAssignmentMutationResult>;
  hasServiceAssignment(
    tenantId: string,
    doctorId: string,
    serviceId: string,
    facilityId: string,
    branchId: string | null,
  ): Promise<boolean>;
}

export type PlatformUserStatusValue = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type PlatformSessionStatusValue = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'COMPROMISED';
export type PlatformRoleCodeValue =
  'OWNER' | 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'SECURITY_ADMIN' | 'SUPPORT_ADMIN';

export interface PlatformUserAuthRecord {
  id: string;
  status: PlatformUserStatusValue;
  tokenVersion: number;
}

export interface PlatformLoginUserRecord extends PlatformUserAuthRecord {
  email: string;
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export interface PlatformUserPersistencePort {
  findAuthRecordById(id: string): Promise<PlatformUserAuthRecord | null>;
  findEmailById(id: string): Promise<string | null>;
  findLoginRecordByEmail(email: string): Promise<PlatformLoginUserRecord | null>;
  recordFailedLogin(
    id: string,
    threshold: number,
    lockMinutes: number,
  ): Promise<{ lockApplied: boolean }>;
  resetFailedLogins(id: string): Promise<void>;
}

export interface CreatePlatformSessionRecord {
  userId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PlatformSessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  tokenFamilyId: string;
  status: PlatformSessionStatusValue;
  ipAddress: string | null;
  userAgent: string | null;
  deviceName: string | null;
  deviceType: string | null;
  browser: string | null;
  operatingSystem: string | null;
  countryCode: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  revocationReason: string | null;
}

export type PlatformRefreshRotationResult =
  | { kind: 'rotated'; session: PlatformSessionRecord }
  | { kind: 'reused'; sessionId: string; subjectUserId: string }
  | { kind: 'not-found' }
  | { kind: 'revoked' }
  | { kind: 'compromised'; sessionId: string; subjectUserId: string }
  | { kind: 'expired' };

export interface PlatformSessionPersistencePort {
  create(data: CreatePlatformSessionRecord): Promise<PlatformSessionRecord>;
  findById(id: string): Promise<PlatformSessionRecord | null>;
  findByIdForUser(id: string, userId: string): Promise<PlatformSessionRecord | null>;
  listByUserId(userId: string): Promise<PlatformSessionRecord[]>;
  findActiveByUserId(userId: string): Promise<PlatformSessionRecord[]>;
  findByRefreshTokenHash(hash: string): Promise<PlatformSessionRecord | null>;
  updateLastActivity(id: string, at?: Date): Promise<PlatformSessionRecord>;
  revoke(id: string, revokedBy?: string, reason?: string): Promise<PlatformSessionRecord>;
  revokeOne(id: string, revokedBy?: string, reason?: string): Promise<PlatformSessionRecord | null>;
  revokeAllForUser(userId: string, revokedBy?: string, reason?: string): Promise<number>;
  revokeAll(userId: string, revokedBy?: string, reason?: string): Promise<number>;
  markExpired(id: string): Promise<PlatformSessionRecord>;
  markCompromised(id: string): Promise<PlatformSessionRecord>;
  findByTokenFamilyId(tokenFamilyId: string): Promise<PlatformSessionRecord[]>;
  updateRefreshTokenHash(id: string, hash: string): Promise<PlatformSessionRecord>;
  rotateByRefreshTokenHash(
    presentedHash: string,
    newTokenHash: string,
    now?: Date,
  ): Promise<PlatformRefreshRotationResult>;
}

export interface PlatformAuthorizationPersistencePort {
  findRoleCodesByUserId(userId: string): Promise<PlatformRoleCodeValue[]>;
  findRoleIdsByUserId(userId: string): Promise<string[]>;
  findPermissionCodesByUserId(userId: string): Promise<string[]>;
}

export type FeatureStatusValue = 'ACTIVE' | 'INACTIVE';
export type PlanStatusValue = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface FeatureRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: FeatureStatusValue;
  statusChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureListFilter {
  status?: FeatureStatusValue;
  limit: number;
  offset: number;
}

export interface FeatureCreateInput {
  key: string;
  name: string;
  description?: string;
}

export interface FeatureUpdateInput {
  name?: string;
  description?: string | null;
}

export interface FeaturePersistencePort {
  create(input: FeatureCreateInput): Promise<FeatureRecord>;
  findById(id: string): Promise<FeatureRecord | null>;
  findByKey(key: string): Promise<FeatureRecord | null>;
  list(filter: FeatureListFilter): Promise<FeatureRecord[]>;
  updateIfCurrentStatus(
    id: string,
    expectedStatus: FeatureStatusValue,
    input: FeatureUpdateInput,
  ): Promise<FeatureRecord | null>;
  changeStatusIfCurrent(
    id: string,
    expectedStatus: FeatureStatusValue,
    nextStatus: FeatureStatusValue,
    changedAt: Date,
  ): Promise<FeatureRecord | null>;
}

export interface PlanRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: PlanStatusValue;
  statusChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanFeatureRecord {
  planId: string;
  featureId: string;
  enabled: boolean;
  quotaLimits: unknown;
  createdAt: Date;
  updatedAt: Date;
  feature: FeatureRecord;
}

export interface PlanListFilter {
  status?: PlanStatusValue;
  limit: number;
  offset: number;
}

export interface PlanCreateInput {
  key: string;
  name: string;
  description?: string;
}

export interface PlanUpdateInput {
  name?: string;
  description?: string | null;
}

export interface PlanFeatureConfigurationInput {
  enabled?: boolean;
  quotaLimits?: PlanFeatureQuotaLimits | null;
}

export interface PlanPersistencePort {
  create(input: PlanCreateInput): Promise<PlanRecord>;
  findById(id: string): Promise<PlanRecord | null>;
  findByKey(key: string): Promise<PlanRecord | null>;
  list(filter: PlanListFilter): Promise<PlanRecord[]>;
  updateIfCurrentStatus(
    id: string,
    expectedStatus: PlanStatusValue,
    input: PlanUpdateInput,
  ): Promise<PlanRecord | null>;
  changeStatusIfCurrent(
    id: string,
    expectedStatus: PlanStatusValue,
    nextStatus: PlanStatusValue,
    changedAt: Date,
  ): Promise<PlanRecord | null>;
  findPlanFeature(planId: string, featureId: string): Promise<PlanFeatureRecord | null>;
  listFeatures(planId: string): Promise<PlanFeatureRecord[]>;
  attachFeature(planId: string, featureId: string): Promise<PlanFeatureRecord>;
  updateFeatureConfiguration(
    planId: string,
    featureId: string,
    input: PlanFeatureConfigurationInput,
  ): Promise<PlanFeatureRecord | null>;
  detachFeature(planId: string, featureId: string): Promise<boolean>;
}

export type PlatformAuditEvent =
  | 'AUTH_LOGIN_SUCCEEDED'
  | 'AUTH_LOGOUT'
  | 'AUTH_LOGOUT_ALL'
  | 'TENANT_CREATED'
  | 'TENANT_STATUS_CHANGED'
  | 'TENANT_DEACTIVATED'
  | 'TENANT_MEMBERSHIP_INVITED'
  | 'TENANT_MEMBERSHIP_ACTIVATED'
  | 'TENANT_MEMBERSHIP_SUSPENDED'
  | 'TENANT_MEMBERSHIP_REMOVED'
  | 'TENANT_ROLE_CREATED'
  | 'TENANT_ROLE_UPDATED'
  | 'TENANT_ROLE_PERMISSIONS_UPDATED'
  | 'TENANT_MEMBERSHIP_ROLE_ASSIGNED'
  | 'TENANT_MEMBERSHIP_ROLE_REMOVED'
  | 'TENANT_OWNER_ASSIGNED'
  | 'TENANT_AUTHORIZATION_DENIED'
  | 'FACILITY_CREATED'
  | 'FACILITY_UPDATED'
  | 'FACILITY_SUSPENDED'
  | 'FACILITY_ACTIVATED'
  | 'FACILITY_DEACTIVATED'
  | 'BRANCH_CREATED'
  | 'BRANCH_UPDATED'
  | 'BRANCH_SUSPENDED'
  | 'BRANCH_ACTIVATED'
  | 'BRANCH_DEACTIVATED'
  | 'STAFF_CREATED'
  | 'STAFF_UPDATED'
  | 'STAFF_SUSPENDED'
  | 'STAFF_ACTIVATED'
  | 'STAFF_DEACTIVATED'
  | 'STAFF_ROLE_ASSIGNED'
  | 'STAFF_ROLE_REMOVED'
  | 'STAFF_FACILITY_ASSIGNED'
  | 'STAFF_FACILITY_UNASSIGNED'
  | 'STAFF_BRANCH_ASSIGNED'
  | 'STAFF_BRANCH_UNASSIGNED'
  | 'DEPARTMENT_CREATED'
  | 'DEPARTMENT_UPDATED'
  | 'DEPARTMENT_ACTIVATED'
  | 'DEPARTMENT_SUSPENDED'
  | 'DEPARTMENT_DEACTIVATED'
  | 'SPECIALTY_CREATED'
  | 'SPECIALTY_UPDATED'
  | 'SPECIALTY_ACTIVATED'
  | 'SPECIALTY_SUSPENDED'
  | 'SPECIALTY_DEACTIVATED'
  | 'SERVICE_CREATED'
  | 'SERVICE_UPDATED'
  | 'SERVICE_STATUS_CHANGED'
  | 'DOCTOR_CREATED'
  | 'DOCTOR_UPDATED'
  | 'DOCTOR_ACTIVATED'
  | 'DOCTOR_SUSPENDED'
  | 'DOCTOR_DEACTIVATED'
  | 'DOCTOR_DEPARTMENT_ASSIGNED'
  | 'DOCTOR_DEPARTMENT_UNASSIGNED'
  | 'DOCTOR_SPECIALTY_ASSIGNED'
  | 'DOCTOR_SPECIALTY_UNASSIGNED'
  | 'DOCTOR_SERVICE_ASSIGNED'
  | 'DOCTOR_SERVICE_UNASSIGNED'
  | 'PATIENT_CREATED'
  | 'PATIENT_UPDATED'
  | 'PATIENT_STATUS_CHANGED'
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_UPDATED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_CANCELLED'
  | 'ENCOUNTER_CREATED'
  | 'ENCOUNTER_CLINICAL_UPDATED'
  | 'ENCOUNTER_COMPLETED'
  | 'ENCOUNTER_CANCELLED'
  | 'SCHEDULING_POLICY_CREATED'
  | 'SCHEDULING_POLICY_UPDATED'
  | 'SCHEDULING_POLICY_ACTIVATED'
  | 'SCHEDULING_POLICY_DEACTIVATED'
  | 'PLAN_CREATED'
  | 'PLAN_UPDATED'
  | 'PLAN_ACTIVATED'
  | 'PLAN_DEACTIVATED'
  | 'PLAN_ARCHIVED'
  | 'FEATURE_CREATED'
  | 'FEATURE_UPDATED'
  | 'FEATURE_ACTIVATED'
  | 'FEATURE_DEACTIVATED'
  | 'PLAN_FEATURE_ATTACHED'
  | 'PLAN_FEATURE_UPDATED'
  | 'PLAN_FEATURE_DETACHED'
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_ACTIVATED'
  | 'SUBSCRIPTION_SUSPENDED'
  | 'SUBSCRIPTION_CANCELLED'
  | 'SUBSCRIPTION_EXPIRED';

export type PlatformSecurityEvent =
  | 'AUTH_LOGIN_FAILED'
  | 'AUTH_ACCOUNT_LOCKED'
  | 'AUTH_REFRESH_TOKEN_REUSE'
  | 'AUTH_REFRESH_SESSION_COMPROMISED'
  | 'AUTHORIZATION_DENIED';

export interface AuditSecurityContext {
  actorUserId?: string;
  subjectUserId?: string;
  subjectTenantId?: string;
  sessionId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export type SafeAuditMetadata = Readonly<Record<string, string | number | boolean | null>>;

export interface CreatePlatformAuditRecord extends AuditSecurityContext {
  id?: string;
  eventType: PlatformAuditEvent;
  metadata: SafeAuditMetadata;
}

export interface CreatePlatformSecurityRecord extends AuditSecurityContext {
  eventType: PlatformSecurityEvent;
  metadata: SafeAuditMetadata;
}

export interface PlatformAuditRecord {
  id: string;
  eventType: PlatformAuditEvent;
  actorUserId: string | null;
  subjectUserId: string | null;
  subjectTenantId: string | null;
  sessionId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: Date;
  metadata: unknown;
}

export interface PlatformSecurityRecord {
  id: string;
  eventType: PlatformSecurityEvent;
  status: 'OPEN' | 'RESOLVED';
  actorUserId: string | null;
  subjectUserId: string | null;
  sessionId: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  updatedAt: Date;
  metadata: unknown;
}

export interface PlatformAuditPersistencePort {
  createAuditLog(data: CreatePlatformAuditRecord): Promise<PlatformAuditRecord>;
  findAuditLog(id: string): Promise<PlatformAuditRecord | null>;
  createSecurityEvent(data: CreatePlatformSecurityRecord): Promise<PlatformSecurityRecord>;
  resolveSecurityEvent(id: string, resolvedBy: string, resolutionNote?: string): Promise<boolean>;
}
