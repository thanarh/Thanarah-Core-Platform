import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType } from '@prisma/client';
import type { TenantAuthorizationService as TenantAuthorizationContract } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TENANT_PERMISSION_CODES } from './tenant-authorization.constants';
import { TenantPermissionDeniedError } from './tenant-authorization.errors';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import {
  TENANT_MEMBERSHIP_ROLE_PERSISTENCE,
  type TenantMembershipRolePersistencePort,
} from '../persistence/platform-persistence.ports';

@Injectable()
export class TenantAuthorizationService implements TenantAuthorizationContract {
  constructor(
    @Inject(TENANT_MEMBERSHIP_ROLE_PERSISTENCE)
    private readonly memberships: TenantMembershipRolePersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  getEffectivePermissionCodes(context: TrustedTenantContext): Promise<string[]> {
    return this.memberships.resolvePermissionCodes(context);
  }

  async authorize(context: TrustedTenantContext, permissionCode: string): Promise<void> {
    if (!(TENANT_PERMISSION_CODES as readonly string[]).includes(permissionCode)) {
      throw new TenantPermissionDeniedError();
    }

    const effectivePermissions = await this.memberships.resolvePermissionCodes(context);
    if (effectivePermissions.includes(permissionCode)) return;

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_AUTHORIZATION_DENIED,
      actorUserId: context.platformUserId,
      subjectTenantId: context.tenantId,
      metadata: { permissionCode },
    });
    throw new TenantPermissionDeniedError();
  }
}
