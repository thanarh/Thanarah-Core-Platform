import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { TenantAuthorizationService } from './tenant-authorization.service';
import {
  TENANT_MEMBERSHIP_PERSISTENCE,
  type TenantMembershipPersistencePort,
} from '../persistence/platform-persistence.ports';
import {
  TenantMembershipValidatorService,
  TrustedTenantContextFactoryService,
} from './tenant-context.service';
import { TenantWorkspaceListResponseDto } from './tenant-workspace.openapi';

@ApiTags('Tenant Workspace')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/session/tenants`)
export class TenantWorkspaceController {
  constructor(
    @Inject(TENANT_MEMBERSHIP_PERSISTENCE)
    private readonly memberships: TenantMembershipPersistencePort,
    private readonly membershipValidator: TenantMembershipValidatorService,
    private readonly tenantContextFactory: TrustedTenantContextFactoryService,
    private readonly authorization: TenantAuthorizationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List the authenticated user’s active tenant workspaces and effective permissions',
    description:
      'Returns only active memberships for the authenticated platform user. Permission codes are resolved by the server.',
  })
  @ApiOkResponse({ type: TenantWorkspaceListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  async list(
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ): Promise<TenantWorkspaceListResponseDto> {
    const memberships = await this.memberships.listActiveForPlatformUser(actor.userId);
    const items = await Promise.all(
      memberships.map(async (membership) => {
        const validated = await this.membershipValidator.validateMembership({
          authenticatedPlatformUser: actor,
          tenantIdCandidate: membership.tenantId,
        });
        const context = this.tenantContextFactory.fromValidatedMembership(validated);
        const permissionCodes = await this.authorization.getEffectivePermissionCodes(context);

        return {
          tenantId: membership.tenantId,
          displayName: membership.tenant.displayName,
          slug: membership.tenant.slug,
          membershipId: membership.id,
          permissionCodes,
        };
      }),
    );

    return { items };
  }
}
