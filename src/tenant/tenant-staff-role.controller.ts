import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import { tenantRoleIdSchema } from './tenant-role.dto';
import { tenantStaffIdSchema } from './tenant-staff.dto';
import {
  CreateTenantStaffRoleAssignmentRequestDto,
  TenantStaffRoleAssignmentListResponseDto,
  TenantStaffRoleAssignmentResponseDto,
} from './tenant-staff-role.openapi';
import {
  createTenantStaffRoleAssignmentSchema,
  type CreateTenantStaffRoleAssignmentInput,
} from './tenant-staff-role.dto';
import {
  TenantStaffRoleService,
  type TenantStaffRoleAuditContext,
} from './tenant-staff-role.service';

@ApiTags('Tenant Staff Roles')
@ApiBearerAuth()
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/staff/:staffId/roles`)
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
export class TenantStaffRoleController {
  constructor(
    @Inject(TenantStaffRoleService) private readonly staffRoles: TenantStaffRoleService,
  ) {}

  @Get()
  @RequireTenantPermissions('tenant.staff.roles.read')
  @ApiOperation({
    summary: 'List roles assigned to a staff profile',
    description:
      'Lists tenant roles assigned to this staff profile. Effective permissions are resolved from the current role definitions.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: TenantStaffRoleAssignmentListResponseDto })
  @ApiBadRequestResponse({ description: 'Staff identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.roles.read is required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
  ): ReturnType<TenantStaffRoleService['list']> {
    return this.staffRoles.list(context, staffId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.staff.roles.manage')
  @ApiOperation({
    summary: 'Assign an existing tenant role to a staff profile',
    description:
      'Accepts only roleId. The role must belong to the trusted tenant; active staff receive its permissions through the existing tenant authorization resolver.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiBody({ type: CreateTenantStaffRoleAssignmentRequestDto })
  @ApiCreatedResponse({ type: TenantStaffRoleAssignmentResponseDto })
  @ApiBadRequestResponse({ description: 'Role assignment request or identifier is invalid' })
  @ApiConflictResponse({
    description: 'Staff or membership is inactive, or the assignment violates an owner invariant',
  })
  @ApiNotFoundResponse({ description: 'Staff profile or tenant role was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'tenant.staff.roles.manage is required; self-assignment is forbidden',
  })
  assign(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @Body(new ZodValidationPipe(createTenantStaffRoleAssignmentSchema))
    body: CreateTenantStaffRoleAssignmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffRoleService['assign']> {
    return this.staffRoles.assign(context, staffId, body, actor, this.requestContext(request));
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantPermissions('tenant.staff.roles.manage')
  @ApiOperation({
    summary: 'Remove a role assignment from a staff profile',
    description:
      'Removes only this staff-to-role assignment; it does not change the role or staff.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Staff role assignment removed' })
  @ApiBadRequestResponse({ description: 'Staff or role identifier is invalid' })
  @ApiConflictResponse({ description: 'OWNER role assignments cannot be removed' })
  @ApiNotFoundResponse({
    description: 'Staff profile, tenant role, or assignment was not found',
  })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.roles.manage is required' })
  remove(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @Param('roleId', new ZodValidationPipe(tenantRoleIdSchema)) roleId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffRoleService['remove']> {
    return this.staffRoles.remove(context, staffId, roleId, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): TenantStaffRoleAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
