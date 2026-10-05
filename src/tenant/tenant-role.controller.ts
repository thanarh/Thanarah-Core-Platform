import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextGuard } from './tenant-context.guard';
import {
  createTenantRoleSchema,
  replaceTenantRolePermissionsSchema,
  tenantRoleIdSchema,
  updateTenantRoleSchema,
  type CreateTenantRoleInput,
  type ReplaceTenantRolePermissionsInput,
  type UpdateTenantRoleInput,
} from './tenant-role.dto';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import { TenantRoleService, type TenantRoleAuditContext } from './tenant-role.service';

@ApiTags('Tenant Roles')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId`)
export class TenantRoleController {
  constructor(@Inject(TenantRoleService) private readonly roles: TenantRoleService) {}

  @Get('roles')
  @RequireTenantPermissions('tenant.roles.read')
  @ApiOperation({ summary: 'List roles for the trusted tenant' })
  @ApiOkResponse({ description: 'Tenant roles and permission codes returned' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  listRoles(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): ReturnType<TenantRoleService['listRoles']> {
    return this.roles.listRoles(context);
  }

  @Get('roles/:roleId')
  @RequireTenantPermissions('tenant.roles.read')
  @ApiOperation({ summary: 'Inspect a tenant role and its permissions' })
  @ApiOkResponse({ description: 'Tenant role returned' })
  @ApiBadRequestResponse({ description: 'Tenant role identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Role does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  getRole(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('roleId', new ZodValidationPipe(tenantRoleIdSchema)) roleId: string,
  ): ReturnType<TenantRoleService['getRole']> {
    return this.roles.getRole(context, roleId);
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.roles.manage')
  @ApiOperation({ summary: 'Create a tenant-specific custom role' })
  @ApiCreatedResponse({ description: 'Tenant role created' })
  @ApiBadRequestResponse({ description: 'Role details are invalid or use a reserved code' })
  @ApiConflictResponse({ description: 'Role code is already used in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant role management permission is required' })
  createRole(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createTenantRoleSchema)) body: CreateTenantRoleInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantRoleService['createRole']> {
    return this.roles.createRole(context, body, actor, this.requestContext(request));
  }

  @Patch('roles/:roleId')
  @RequireTenantPermissions('tenant.roles.manage')
  @ApiOperation({ summary: 'Update custom tenant role metadata' })
  @ApiOkResponse({ description: 'Tenant role metadata updated' })
  @ApiBadRequestResponse({ description: 'Role identifier or metadata is invalid' })
  @ApiConflictResponse({ description: 'Default tenant roles cannot be updated' })
  @ApiNotFoundResponse({ description: 'Role does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant role management permission is required' })
  updateRole(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('roleId', new ZodValidationPipe(tenantRoleIdSchema)) roleId: string,
    @Body(new ZodValidationPipe(updateTenantRoleSchema)) body: UpdateTenantRoleInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantRoleService['updateRole']> {
    return this.roles.updateRole(context, roleId, body, actor, this.requestContext(request));
  }

  @Put('roles/:roleId/permissions')
  @RequireTenantPermissions('tenant.roles.permissions.manage')
  @ApiOperation({ summary: 'Replace permissions on a custom tenant role' })
  @ApiOkResponse({ description: 'Tenant role permissions replaced' })
  @ApiBadRequestResponse({ description: 'Permission codes are invalid or duplicated' })
  @ApiConflictResponse({ description: 'Default tenant roles cannot be modified' })
  @ApiNotFoundResponse({ description: 'Role does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant owner permission management is required' })
  replacePermissions(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('roleId', new ZodValidationPipe(tenantRoleIdSchema)) roleId: string,
    @Body(new ZodValidationPipe(replaceTenantRolePermissionsSchema))
    body: ReplaceTenantRolePermissionsInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantRoleService['replacePermissions']> {
    return this.roles.replacePermissions(
      context,
      roleId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Get('memberships/:membershipId/roles')
  @RequireTenantPermissions('tenant.members.read')
  @ApiOperation({ summary: 'List roles assigned to a tenant membership' })
  @ApiOkResponse({ description: 'Membership role assignments returned' })
  @ApiBadRequestResponse({ description: 'Membership identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Membership does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant member read permission is required' })
  listMembershipRoles(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('membershipId') membershipId: string,
  ): ReturnType<TenantRoleService['listMembershipRoles']> {
    return this.roles.listMembershipRoles(context, membershipId);
  }

  @Post('memberships/:membershipId/roles/:roleId')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.members.roles.manage')
  @ApiOperation({ summary: 'Assign a tenant role to a different active member' })
  @ApiCreatedResponse({ description: 'Tenant role assigned' })
  @ApiBadRequestResponse({ description: 'Membership or role identifier is invalid' })
  @ApiConflictResponse({ description: 'Owner role assignment violates an ownership invariant' })
  @ApiNotFoundResponse({ description: 'Membership or role does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant member role management permission is required' })
  assignRole(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('membershipId') membershipId: string,
    @Param('roleId', new ZodValidationPipe(tenantRoleIdSchema)) roleId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.roles.assignRole(
      context,
      membershipId,
      roleId,
      actor,
      this.requestContext(request),
    );
  }

  @Delete('memberships/:membershipId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantPermissions('tenant.members.roles.manage')
  @ApiOperation({ summary: 'Remove a non-owner role from a tenant membership' })
  @ApiNoContentResponse({ description: 'Tenant role assignment removed' })
  @ApiBadRequestResponse({ description: 'Membership or role identifier is invalid' })
  @ApiConflictResponse({ description: 'Tenant owner assignments cannot be removed' })
  @ApiNotFoundResponse({ description: 'Membership or role assignment was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant member role management permission is required' })
  removeRole(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('membershipId') membershipId: string,
    @Param('roleId', new ZodValidationPipe(tenantRoleIdSchema)) roleId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    return this.roles.removeRole(
      context,
      membershipId,
      roleId,
      actor,
      this.requestContext(request),
    );
  }

  private requestContext(request: FastifyRequest): TenantRoleAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
