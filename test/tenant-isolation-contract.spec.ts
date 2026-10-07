import { HttpStatus } from '@nestjs/common';
import { BranchStatus } from '@prisma/client';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import type { BranchRecord, BranchRepository } from '../src/tenant/branch.repository';
import type { PatientRecord } from '../src/tenant/patient.model';
import type { PatientRepository } from '../src/tenant/patient.repository';
import {
  BranchFacilityNotFoundError,
  BranchNotFoundError,
  BranchParentUnavailableError,
} from '../src/tenant/branch.errors';
import {
  TenantContextInvalidError,
  TenantContextRequiredError,
  type TenantAuthorizationService,
  type TenantMembershipValidator,
  type TrustedTenantContext,
  type TrustedTenantContextFactory,
  type ValidatedTenantMembership,
} from '../src/tenant/tenant-context.contract';
import type {
  TenantDatabaseRegistry,
  TenantScopedRepository,
  TenantStoragePlacement,
  TenantStoragePlacementId,
  TenantStorageResolver,
  TenantStorageRoute,
} from '../src/tenant/tenant-storage.contract';
import {
  TenantStorageNotConfiguredError,
  TenantStorageUnavailableError,
} from '../src/tenant/tenant-storage.errors';

type AssertTrue<T extends true> = T;
type AssertFalse<T extends false> = T;

type _TenantStorageHasNoPhysicalDatabaseName = AssertFalse<
  'databaseName' extends keyof TenantStoragePlacement ? true : false
>;
type _TenantStorageHasNoConnectionString = AssertFalse<
  'connectionString' extends keyof TenantStoragePlacement ? true : false
>;
type _TenantStorageHasNoDefaultTenantFallback = AssertFalse<
  'defaultTenantId' extends keyof TenantStorageRoute ? true : false
>;
type _TenantStorageHasNoGlobalDatabaseFallback = AssertFalse<
  'globalDatabase' extends keyof TenantStorageRoute ? true : false
>;
type _StorageRouteSupportsMultiplePlacements = AssertTrue<
  readonly [TenantStoragePlacement, TenantStoragePlacement] extends TenantStorageRoute['placements']
    ? true
    : false
>;
type _BranchRecordHasNoDuplicatedTenantId = AssertFalse<
  'tenantId' extends keyof BranchRecord ? true : false
>;
type _PatientRecordHasNoDuplicatedTenantId = AssertFalse<
  'tenantId' extends keyof PatientRecord ? true : false
>;
const tenantContractTypeAssertions: [
  _TenantStorageHasNoPhysicalDatabaseName,
  _TenantStorageHasNoConnectionString,
  _TenantStorageHasNoDefaultTenantFallback,
  _TenantStorageHasNoGlobalDatabaseFallback,
  _StorageRouteSupportsMultiplePlacements,
  _BranchRecordHasNoDuplicatedTenantId,
  _PatientRecordHasNoDuplicatedTenantId,
] = [false, false, false, false, true, false, false];
void tenantContractTypeAssertions;

/**
 * Compile-time assertions: this function is intentionally never invoked.
 * They make omissions and client-controlled scope fail TypeScript checking.
 */
export function verifyTenantIsolationTypes(
  authenticatedPlatformUser: AuthenticatedPlatformUser,
  tenantIdCandidate: string,
  otherTenantIdCandidate: string,
  facilityOrBranchId: string,
  databaseName: string,
  membershipValidator: TenantMembershipValidator,
  contextFactory: TrustedTenantContextFactory,
  context: TrustedTenantContext,
  membership: ValidatedTenantMembership,
  tenantAuthorization: TenantAuthorizationService,
  repository: TenantScopedRepository<{ id: string }>,
  patientRepository: PatientRepository,
  storageResolver: TenantStorageResolver,
  databaseRegistry: TenantDatabaseRegistry,
): void {
  void membershipValidator.validateMembership({
    authenticatedPlatformUser,
    tenantIdCandidate,
  });
  const trustedContext = contextFactory.fromValidatedMembership(membership);
  void repository.findById(trustedContext, 'resource-id');
  void patientRepository.findByIdForTenant(trustedContext, 'patient-id');
  void storageResolver.resolve(trustedContext);
  void databaseRegistry.getPlacements(trustedContext);
  void tenantAuthorization.authorize(trustedContext, 'tenant.resource.read');

  const clientStyleContext = {
    tenantId: tenantIdCandidate,
    membershipId: tenantIdCandidate,
    platformUserId: authenticatedPlatformUser.userId,
  };
  // @ts-expect-error Request-shaped IDs are not trusted context.
  const forgedContext: TrustedTenantContext = clientStyleContext;
  void forgedContext;

  // @ts-expect-error Platform identity alone is not tenant authorization.
  void tenantAuthorization.authorize(authenticatedPlatformUser, 'tenant.resource.read');

  // @ts-expect-error A tenant selector alone is not a validated membership.
  void membershipValidator.validateMembership(tenantIdCandidate);

  const clientStyleMembership = {
    tenantId: tenantIdCandidate,
    membershipId: tenantIdCandidate,
    platformUserId: authenticatedPlatformUser.userId,
  };
  // @ts-expect-error The factory accepts only a server-validated membership.
  void contextFactory.fromValidatedMembership(clientStyleMembership);

  // @ts-expect-error Tenant-owned repository operations require trusted scope.
  void repository.findById('resource-id');

  // @ts-expect-error A client tenant ID cannot stand in for trusted scope.
  void repository.findById(tenantIdCandidate, 'resource-id');

  // @ts-expect-error A facility or branch ID cannot replace tenant scope.
  void repository.findById(facilityOrBranchId, 'resource-id');

  // @ts-expect-error Context is the sole tenant scope; callers cannot override it.
  void repository.findById(context, 'resource-id', otherTenantIdCandidate);

  // @ts-expect-error Patient repository operations require trusted tenant scope.
  void patientRepository.findByIdForTenant('patient-id');

  // @ts-expect-error A client tenant selector cannot stand in for trusted patient scope.
  void patientRepository.findByIdForTenant(tenantIdCandidate, 'patient-id');

  // @ts-expect-error Storage resolution requires trusted context, not a selector.
  void storageResolver.resolve(tenantIdCandidate);

  // @ts-expect-error Registry lookup requires trusted context, not a DB name.
  void databaseRegistry.getPlacements(databaseName);

  // @ts-expect-error Physical database names are not placement references.
  const clientControlledPlacementId: TenantStoragePlacementId = databaseName;
  void clientControlledPlacementId;

  // @ts-expect-error A resolved storage route cannot silently have no placement.
  const emptyStorageRoute: TenantStorageRoute = { placements: [] };
  void emptyStorageRoute;
}

/** Compile-time assertions for the nested Branch → Facility → Tenant scope. */
export function verifyBranchIsolationTypes(
  repository: BranchRepository,
  trustedTenantId: string,
  facilityId: string,
  branchId: string,
): void {
  void repository.findByIdWithinFacility(trustedTenantId, facilityId, branchId);
  void repository.listForFacility(trustedTenantId, facilityId, { limit: 50, offset: 0 });
  void repository.listForFacility(trustedTenantId, facilityId, {
    status: BranchStatus.ACTIVE,
    limit: 50,
    offset: 0,
  });

  // @ts-expect-error A Branch identifier cannot replace trusted Tenant and Facility scope.
  void repository.findByIdWithinFacility(branchId);

  // @ts-expect-error A Branch lookup cannot omit either parent scope identifier.
  void repository.findByIdWithinFacility(trustedTenantId, branchId);
}

void verifyTenantIsolationTypes;
void verifyBranchIsolationTypes;

describe('tenant isolation contract', () => {
  it('keeps client-shaped data and platform identity distinct from trusted context', () => {
    expectTypeOf<{
      tenantId: string;
      membershipId: string;
      platformUserId: string;
    }>().not.toMatchTypeOf<TrustedTenantContext>();
    expectTypeOf<AuthenticatedPlatformUser>().not.toMatchTypeOf<TrustedTenantContext>();
  });

  it.each([
    [
      new TenantContextRequiredError(),
      'TENANT_CONTEXT_REQUIRED',
      'A trusted tenant context is required',
    ],
    [
      new TenantContextInvalidError(),
      'TENANT_CONTEXT_INVALID',
      'The trusted tenant context is invalid',
    ],
  ])('fails closed with a stable, sanitized error', (error, code, message) => {
    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(error.getResponse()).toEqual({ code, message });
    expect(JSON.stringify(error.getResponse())).not.toMatch(/database|connection|mongodb/i);
  });

  it.each([
    [
      new TenantStorageNotConfiguredError(),
      'TENANT_STORAGE_NOT_CONFIGURED',
      'Tenant storage is not configured',
    ],
    [
      new TenantStorageUnavailableError(),
      'TENANT_STORAGE_UNAVAILABLE',
      'Tenant storage is currently unavailable',
    ],
  ])('fails closed with a stable, sanitized storage error', (error, code, message) => {
    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(error.getResponse()).toEqual({ code, message });
    expect(JSON.stringify(error.getResponse())).not.toMatch(/database|connection|mongodb/i);
  });

  it.each([
    [
      new BranchFacilityNotFoundError(),
      HttpStatus.NOT_FOUND,
      'BRANCH_FACILITY_NOT_FOUND',
      'Facility was not found in the trusted tenant',
    ],
    [
      new BranchNotFoundError(),
      HttpStatus.NOT_FOUND,
      'BRANCH_NOT_FOUND',
      'Branch was not found under the requested Facility',
    ],
    [
      new BranchParentUnavailableError(),
      HttpStatus.CONFLICT,
      'BRANCH_PARENT_UNAVAILABLE',
      'Branch operations require an active tenant and active Facility',
    ],
  ])('returns a safe scoped Branch error', (error, status, code, message) => {
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toEqual({ code, message });
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /tenantId|facilityId|branchId|database|connection|mongodb/i,
    );
  });
});
