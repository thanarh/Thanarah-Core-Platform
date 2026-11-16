import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';

declare const tenantIdBrand: unique symbol;
declare const tenantMembershipIdBrand: unique symbol;
declare const validatedTenantMembershipBrand: unique symbol;
declare const trustedTenantContextBrand: unique symbol;
declare const trustedPatientPortalContextBrand: unique symbol;

export type TenantId = string & { readonly [tenantIdBrand]: true };
export type TenantMembershipId = string & { readonly [tenantMembershipIdBrand]: true };

/**
 * A server-validated membership. Its opaque brand prevents request-shaped
 * objects from being passed directly to the tenant-context factory.
 */
export interface ValidatedTenantMembership {
  readonly tenantId: TenantId;
  readonly membershipId: TenantMembershipId;
  readonly platformUserId: string;
  readonly [validatedTenantMembershipBrand]: true;
}

/**
 * Future implementations must validate membership against trusted platform
 * data. tenantIdCandidate is only a selector, never proof of access.
 */
export interface TenantMembershipValidator {
  validateMembership(input: {
    readonly authenticatedPlatformUser: AuthenticatedPlatformUser;
    readonly tenantIdCandidate: string;
  }): Promise<ValidatedTenantMembership>;
}

/**
 * Opaque server-side scope created only from a validated membership. It keeps
 * tenant, membership, and platform-user identities distinct.
 */
export interface TrustedTenantContext {
  readonly tenantId: TenantId;
  readonly membershipId: TenantMembershipId;
  readonly platformUserId: string;
  readonly [trustedTenantContextBrand]: true;
}

/**
 * A narrowly scoped context for patient self-service. It is created only by
 * the patient portal after matching the authenticated account and verifying
 * control of the phone stored on that patient's tenant record.
 */
export interface TrustedPatientPortalContext {
  readonly tenantId: TenantId;
  readonly platformUserId: string;
  readonly [trustedPatientPortalContextBrand]: true;
}

export type TrustedTenantStorageContext = TrustedTenantContext | TrustedPatientPortalContext;

const tenantContextUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isWellFormedTrustedTenantContext(value: unknown): value is TrustedTenantContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return (
    typeof context.tenantId === 'string' &&
    tenantContextUuidPattern.test(context.tenantId) &&
    typeof context.membershipId === 'string' &&
    tenantContextUuidPattern.test(context.membershipId) &&
    typeof context.platformUserId === 'string' &&
    context.platformUserId.trim().length > 0
  );
}

export function isWellFormedTrustedPatientPortalContext(
  value: unknown,
): value is TrustedPatientPortalContext {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return (
    typeof context.tenantId === 'string' &&
    tenantContextUuidPattern.test(context.tenantId) &&
    typeof context.platformUserId === 'string' &&
    context.platformUserId.trim().length > 0
  );
}

export function isWellFormedTrustedTenantStorageContext(
  value: unknown,
): value is TrustedTenantStorageContext {
  return (
    isWellFormedTrustedTenantContext(value) || isWellFormedTrustedPatientPortalContext(value)
  );
}

export interface TrustedTenantContextFactory {
  fromValidatedMembership(membership: ValidatedTenantMembership): TrustedTenantContext;
}

/** Tenant authorization is a separate decision from platform authentication. */
export interface TenantAuthorizationService {
  authorize(context: TrustedTenantContext, permissionCode: string): Promise<void>;
}

export class TenantContextRequiredError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_CONTEXT_REQUIRED',
      message: 'A trusted tenant context is required',
    });
  }
}

export class TenantContextInvalidError extends ForbiddenException {
  constructor() {
    super({
      code: 'TENANT_CONTEXT_INVALID',
      message: 'The trusted tenant context is invalid',
    });
  }
}
