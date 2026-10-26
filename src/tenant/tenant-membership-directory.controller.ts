import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import {
  listTenantMembershipsQuerySchema,
  type ListTenantMembershipsQuery,
} from './tenant-membership.dto';
import { TenantMembershipService } from './tenant-membership.service';

@ApiTags('Tenant Members')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/memberships`)
export class TenantMembershipDirectoryController {
  constructor(
    @Inject(TenantMembershipService) private readonly memberships: TenantMembershipService,
  ) {}

  @Get()
  @RequireTenantPermissions('tenant.members.read')
  @ApiOperation({ summary: 'List members in the trusted tenant workspace' })
  @ApiOkResponse({ description: 'Tenant membership directory returned' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Active membership and tenant.members.read are required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listTenantMembershipsQuerySchema))
    query: ListTenantMembershipsQuery,
  ): ReturnType<TenantMembershipService['listDirectoryForTrustedTenant']> {
    return this.memberships.listDirectoryForTrustedTenant(context, query);
  }
}
