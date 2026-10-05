import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../auth/guards/platform-authorization.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { tenantIdSchema } from './tenant.dto';
import {
  createTenantMembershipSchema,
  listTenantMembershipsQuerySchema,
  tenantMembershipIdSchema,
  type CreateTenantMembershipInput,
  type ListTenantMembershipsQuery,
} from './tenant-membership.dto';
import {
  TenantMembershipService,
  type TenantMembershipAuditContext,
} from './tenant-membership.service';
import type { TenantMembershipRecord } from './tenant-membership.repository';

@ApiTags('Tenant Memberships')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/platform/tenants/:tenantId/memberships`)
export class TenantMembershipController {
  constructor(
    @Inject(TenantMembershipService) private readonly memberships: TenantMembershipService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('platform.manage')
  @ApiOperation({ summary: 'Invite a platform user to a tenant' })
  @ApiCreatedResponse({ description: 'Tenant membership invitation created' })
  @ApiBadRequestResponse({ description: 'Tenant or membership input is invalid' })
  @ApiConflictResponse({ description: 'A membership already exists for this tenant and user' })
  @ApiNotFoundResponse({ description: 'Tenant or platform user was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform management permission is required' })
  invite(
    @Param('tenantId', new ZodValidationPipe(tenantIdSchema)) tenantId: string,
    @Body(new ZodValidationPipe(createTenantMembershipSchema)) body: CreateTenantMembershipInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<TenantMembershipRecord> {
    return this.memberships.invite(tenantId, body, actor, this.requestContext(request));
  }

  @Get()
  @RequirePermissions('platform.read')
  @ApiOperation({ summary: 'List memberships for a tenant' })
  @ApiOkResponse({ description: 'Tenant memberships returned' })
  @ApiBadRequestResponse({ description: 'Tenant or list filters are invalid' })
  @ApiNotFoundResponse({ description: 'Tenant was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform read permission is required' })
  list(
    @Param('tenantId', new ZodValidationPipe(tenantIdSchema)) tenantId: string,
    @Query(new ZodValidationPipe(listTenantMembershipsQuerySchema))
    query: ListTenantMembershipsQuery,
  ): ReturnType<TenantMembershipService['listForTenant']> {
    return this.memberships.listForTenant(tenantId, query);
  }

  @Post(':membershipId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('platform.manage')
  @ApiOperation({ summary: 'Activate an invited or suspended tenant membership' })
  @ApiOkResponse({ description: 'Tenant membership activated' })
  @ApiBadRequestResponse({ description: 'Tenant or membership identifier is invalid' })
  @ApiConflictResponse({ description: 'Membership lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Tenant membership was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform management permission is required' })
  activate(
    @Param('tenantId', new ZodValidationPipe(tenantIdSchema)) tenantId: string,
    @Param('membershipId', new ZodValidationPipe(tenantMembershipIdSchema)) membershipId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<TenantMembershipRecord> {
    return this.memberships.activate(tenantId, membershipId, actor, this.requestContext(request));
  }

  @Post(':membershipId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('platform.manage')
  @ApiOperation({ summary: 'Suspend an active tenant membership' })
  @ApiOkResponse({ description: 'Tenant membership suspended' })
  @ApiBadRequestResponse({ description: 'Tenant or membership identifier is invalid' })
  @ApiConflictResponse({ description: 'Membership lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Tenant membership was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform management permission is required' })
  suspend(
    @Param('tenantId', new ZodValidationPipe(tenantIdSchema)) tenantId: string,
    @Param('membershipId', new ZodValidationPipe(tenantMembershipIdSchema)) membershipId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<TenantMembershipRecord> {
    return this.memberships.suspend(tenantId, membershipId, actor, this.requestContext(request));
  }

  @Post(':membershipId/remove')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('platform.manage')
  @ApiOperation({ summary: 'Remove a tenant membership permanently' })
  @ApiOkResponse({ description: 'Tenant membership removed' })
  @ApiBadRequestResponse({ description: 'Tenant or membership identifier is invalid' })
  @ApiConflictResponse({ description: 'Membership lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Tenant membership was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform management permission is required' })
  remove(
    @Param('tenantId', new ZodValidationPipe(tenantIdSchema)) tenantId: string,
    @Param('membershipId', new ZodValidationPipe(tenantMembershipIdSchema)) membershipId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<TenantMembershipRecord> {
    return this.memberships.remove(tenantId, membershipId, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): TenantMembershipAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
