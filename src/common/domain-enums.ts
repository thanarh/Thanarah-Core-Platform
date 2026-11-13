/** Storage-independent values shared by validation, services and API documentation. */
function values<const T extends readonly string[]>(...items: T): { [K in T[number]]: K } {
  return Object.fromEntries(items.map((value) => [value, value])) as { [K in T[number]]: K };
}
type Value<T> = T[keyof T];

export const UserStatus = values('ACTIVE', 'INACTIVE', 'SUSPENDED');
export type UserStatus = Value<typeof UserStatus>;
export const PlatformSessionStatus = values('ACTIVE', 'REVOKED', 'EXPIRED', 'COMPROMISED');
export type PlatformSessionStatus = Value<typeof PlatformSessionStatus>;
export const TenantStatus = values('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
export type TenantStatus = Value<typeof TenantStatus>;
export const FacilityStatus = values('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
export type FacilityStatus = Value<typeof FacilityStatus>;
export const BranchStatus = values('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
export type BranchStatus = Value<typeof BranchStatus>;
export const StaffStatus = values('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
export type StaffStatus = Value<typeof StaffStatus>;
export const DoctorServiceAssignmentScope = values('FACILITY', 'BRANCH');
export type DoctorServiceAssignmentScope = Value<typeof DoctorServiceAssignmentScope>;
export const PatientStatus = values('ACTIVE', 'INACTIVE');
export type PatientStatus = Value<typeof PatientStatus>;
export const TenantStorageTargetStatus = values('ACTIVE', 'INACTIVE');
export type TenantStorageTargetStatus = Value<typeof TenantStorageTargetStatus>;
export const TenantStorageProvider = values('MONGODB');
export type TenantStorageProvider = Value<typeof TenantStorageProvider>;
export const TenantCatalogStatus = values('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
export type TenantCatalogStatus = Value<typeof TenantCatalogStatus>;
export const PlanStatus = values('ACTIVE', 'INACTIVE', 'ARCHIVED');
export type PlanStatus = Value<typeof PlanStatus>;
export const SubscriptionStatus = values('ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');
export type SubscriptionStatus = Value<typeof SubscriptionStatus>;
export const SubscriptionTransferStatus = values('PENDING_REVIEW', 'APPROVED', 'REJECTED');
export type SubscriptionTransferStatus = Value<typeof SubscriptionTransferStatus>;
export const FeatureStatus = values('ACTIVE', 'INACTIVE');
export type FeatureStatus = Value<typeof FeatureStatus>;
export const TenantMembershipStatus = values('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');
export type TenantMembershipStatus = Value<typeof TenantMembershipStatus>;
export const FacilitySchedulingPolicyStatus = values('INACTIVE', 'ACTIVE');
export type FacilitySchedulingPolicyStatus = Value<typeof FacilitySchedulingPolicyStatus>;
export const FacilitySchedulingPolicyRevisionAction = values(
  'CREATED',
  'UPDATED',
  'ACTIVATED',
  'DEACTIVATED',
);
export type FacilitySchedulingPolicyRevisionAction = Value<
  typeof FacilitySchedulingPolicyRevisionAction
>;
export const PlatformSecurityEventType = values(
  'AUTH_LOGIN_FAILED',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_REFRESH_TOKEN_REUSE',
  'AUTH_REFRESH_SESSION_COMPROMISED',
  'AUTHORIZATION_DENIED',
);
export type PlatformSecurityEventType = Value<typeof PlatformSecurityEventType>;
export const PlatformSecurityEventStatus = values('OPEN', 'RESOLVED');
export type PlatformSecurityEventStatus = Value<typeof PlatformSecurityEventStatus>;
export const EncounterOperationStatus = values(
  'PENDING',
  'FAILED',
  'DELIVERED',
  'RECONCILED',
  'REVIEW_REQUIRED',
);
export type EncounterOperationStatus = Value<typeof EncounterOperationStatus>;
export const EncounterMutationState = values('PREPARED', 'CONFIRMED', 'NOT_APPLIED', 'AMBIGUOUS');
export type EncounterMutationState = Value<typeof EncounterMutationState>;
export const PlatformAuditEventType = values(
  'AUTH_LOGIN_SUCCEEDED',
  'AUTH_LOGOUT',
  'AUTH_LOGOUT_ALL',
  'TENANT_CREATED',
  'TENANT_STATUS_CHANGED',
  'TENANT_DEACTIVATED',
  'TENANT_MEMBERSHIP_INVITED',
  'TENANT_MEMBERSHIP_ACTIVATED',
  'TENANT_MEMBERSHIP_SUSPENDED',
  'TENANT_MEMBERSHIP_REMOVED',
  'TENANT_ROLE_CREATED',
  'TENANT_ROLE_UPDATED',
  'TENANT_ROLE_PERMISSIONS_UPDATED',
  'TENANT_MEMBERSHIP_ROLE_ASSIGNED',
  'TENANT_MEMBERSHIP_ROLE_REMOVED',
  'TENANT_OWNER_ASSIGNED',
  'TENANT_AUTHORIZATION_DENIED',
  'FACILITY_CREATED',
  'FACILITY_UPDATED',
  'FACILITY_SUSPENDED',
  'FACILITY_ACTIVATED',
  'FACILITY_DEACTIVATED',
  'BRANCH_CREATED',
  'BRANCH_UPDATED',
  'BRANCH_SUSPENDED',
  'BRANCH_ACTIVATED',
  'BRANCH_DEACTIVATED',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_SUSPENDED',
  'STAFF_ACTIVATED',
  'STAFF_DEACTIVATED',
  'STAFF_ROLE_ASSIGNED',
  'STAFF_ROLE_REMOVED',
  'STAFF_FACILITY_ASSIGNED',
  'STAFF_FACILITY_UNASSIGNED',
  'STAFF_BRANCH_ASSIGNED',
  'STAFF_BRANCH_UNASSIGNED',
  'DEPARTMENT_CREATED',
  'DEPARTMENT_UPDATED',
  'DEPARTMENT_ACTIVATED',
  'DEPARTMENT_SUSPENDED',
  'DEPARTMENT_DEACTIVATED',
  'SPECIALTY_CREATED',
  'SPECIALTY_UPDATED',
  'SPECIALTY_ACTIVATED',
  'SPECIALTY_SUSPENDED',
  'SPECIALTY_DEACTIVATED',
  'SERVICE_CREATED',
  'SERVICE_UPDATED',
  'SERVICE_STATUS_CHANGED',
  'DOCTOR_CREATED',
  'DOCTOR_UPDATED',
  'DOCTOR_ACTIVATED',
  'DOCTOR_SUSPENDED',
  'DOCTOR_DEACTIVATED',
  'DOCTOR_DEPARTMENT_ASSIGNED',
  'DOCTOR_DEPARTMENT_UNASSIGNED',
  'DOCTOR_SPECIALTY_ASSIGNED',
  'DOCTOR_SPECIALTY_UNASSIGNED',
  'DOCTOR_SERVICE_ASSIGNED',
  'DOCTOR_SERVICE_UNASSIGNED',
  'PATIENT_CREATED',
  'PATIENT_UPDATED',
  'PATIENT_STATUS_CHANGED',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_UPDATED',
  'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CANCELLED',
  'ENCOUNTER_CREATED',
  'ENCOUNTER_CLINICAL_UPDATED',
  'ENCOUNTER_COMPLETED',
  'ENCOUNTER_CANCELLED',
  'SCHEDULING_POLICY_CREATED',
  'SCHEDULING_POLICY_UPDATED',
  'SCHEDULING_POLICY_ACTIVATED',
  'SCHEDULING_POLICY_DEACTIVATED',
  'PLAN_CREATED',
  'PLAN_UPDATED',
  'PLAN_ACTIVATED',
  'PLAN_DEACTIVATED',
  'PLAN_ARCHIVED',
  'FEATURE_CREATED',
  'FEATURE_UPDATED',
  'FEATURE_ACTIVATED',
  'FEATURE_DEACTIVATED',
  'PLAN_FEATURE_ATTACHED',
  'PLAN_FEATURE_UPDATED',
  'PLAN_FEATURE_DETACHED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_ACTIVATED',
  'SUBSCRIPTION_SUSPENDED',
  'SUBSCRIPTION_CANCELLED',
  'SUBSCRIPTION_EXPIRED',
);
export type PlatformAuditEventType = Value<typeof PlatformAuditEventType>;
