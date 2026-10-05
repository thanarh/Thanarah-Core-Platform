import { Injectable } from '@nestjs/common';
import { PlatformAuditEventType } from '@prisma/client';
import type { TenantAuthorizationService as TenantAuthorizationContract } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TENANT_PERMISSION_CODES } from './tenant-authorization.constants';
import { TenantPermissionDeniedError } from './tenant-authorization.errors';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import { TenantMembershipRoleRepository } from './tenant-membership-role.repository';

@Injectable()
export class TenantAuthorizationService implements TenantAuthorizationContract {
  constructor(
    private readonly memberships: TenantMembershipRoleRepository,
    private readonly audit: PlatformAuditService,
  ) {}

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
