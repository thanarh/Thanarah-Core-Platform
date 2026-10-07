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
import { tenantStaffIdSchema } from './tenant-staff.dto';
import {
  createTenantStaffBranchAssignmentSchema,
  createTenantStaffFacilityAssignmentSchema,
  tenantStaffScopeBranchIdSchema,
  tenantStaffScopeFacilityIdSchema,
  type CreateTenantStaffBranchAssignmentInput,
  type CreateTenantStaffFacilityAssignmentInput,
} from './tenant-staff-scope.dto';
import {
  TenantStaffBranchAssignmentListResponseDto,
  TenantStaffBranchAssignmentResponseDto,
  TenantStaffFacilityAssignmentListResponseDto,
  TenantStaffFacilityAssignmentResponseDto,
  CreateTenantStaffBranchAssignmentRequestDto,
  CreateTenantStaffFacilityAssignmentRequestDto,
} from './tenant-staff-scope.openapi';
import {
  TenantStaffScopeService,
  type TenantStaffScopeAuditContext,
} from './tenant-staff-scope.service';

@ApiTags('Tenant Staff Scope')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/staff/:staffId`)
export class TenantStaffScopeController {
  constructor(
    @Inject(TenantStaffScopeService) private readonly staffScope: TenantStaffScopeService,
  ) {}

  @Get('facilities')
  @RequireTenantPermissions('tenant.staff.scope.read')
  @ApiOperation({ summary: 'List facility assignments for a tenant staff profile' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: TenantStaffFacilityAssignmentListResponseDto })
  @ApiBadRequestResponse({ description: 'Staff identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.scope.read is required' })
  listFacilities(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
  ): ReturnType<TenantStaffScopeService['listFacilities']> {
    return this.staffScope.listFacilities(context, staffId);
  }

  @Post('facilities')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.staff.scope.manage')
  @ApiOperation({
    summary: 'Assign a facility to a tenant staff profile',
    description:
      'Accepts only facilityId. The facility must belong to the trusted tenant and be active. A repeated assignment returns the existing record without creating a duplicate.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiBody({ type: CreateTenantStaffFacilityAssignmentRequestDto })
  @ApiCreatedResponse({ type: TenantStaffFacilityAssignmentResponseDto })
  @ApiBadRequestResponse({ description: 'Staff identifier or assignment body is invalid' })
  @ApiConflictResponse({ description: 'Staff or facility is inactive' })
  @ApiNotFoundResponse({ description: 'Staff profile or facility was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.scope.manage is required' })
  assignFacility(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @Body(new ZodValidationPipe(createTenantStaffFacilityAssignmentSchema))
    body: CreateTenantStaffFacilityAssignmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffScopeService['assignFacility']> {
    return this.staffScope.assignFacility(
      context,
      staffId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Delete('facilities/:facilityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantPermissions('tenant.staff.scope.manage')
  @ApiOperation({ summary: 'Remove a facility assignment from a tenant staff profile' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiParam({ name: 'facilityId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Facility assignment removed' })
  @ApiBadRequestResponse({ description: 'Staff or facility identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile, facility, or assignment was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.scope.manage is required' })
  removeFacility(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @Param('facilityId', new ZodValidationPipe(tenantStaffScopeFacilityIdSchema))
    facilityId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffScopeService['removeFacility']> {
    return this.staffScope.removeFacility(
      context,
      staffId,
      facilityId,
      actor,
      this.requestContext(request),
    );
  }

  @Get('branches')
  @RequireTenantPermissions('tenant.staff.scope.read')
  @ApiOperation({ summary: 'List branch assignments for a tenant staff profile' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: TenantStaffBranchAssignmentListResponseDto })
  @ApiBadRequestResponse({ description: 'Staff identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile does not belong to the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.scope.read is required' })
  listBranches(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
  ): ReturnType<TenantStaffScopeService['listBranches']> {
    return this.staffScope.listBranches(context, staffId);
  }

  @Post('branches')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.staff.scope.manage')
  @ApiOperation({
    summary: 'Assign a branch to a tenant staff profile',
    description:
      'Accepts only branchId. The branch and its parent facility must belong to the trusted tenant and be active. Repeated assignments return the existing record; no separate facility assignment is implied.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiBody({ type: CreateTenantStaffBranchAssignmentRequestDto })
  @ApiCreatedResponse({ type: TenantStaffBranchAssignmentResponseDto })
  @ApiBadRequestResponse({ description: 'Staff identifier or assignment body is invalid' })
  @ApiConflictResponse({ description: 'Staff, branch, or parent facility is inactive' })
  @ApiNotFoundResponse({ description: 'Staff profile or branch was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.scope.manage is required' })
  assignBranch(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @Body(new ZodValidationPipe(createTenantStaffBranchAssignmentSchema))
    body: CreateTenantStaffBranchAssignmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffScopeService['assignBranch']> {
    return this.staffScope.assignBranch(
      context,
      staffId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Delete('branches/:branchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenantPermissions('tenant.staff.scope.manage')
  @ApiOperation({ summary: 'Remove a branch assignment from a tenant staff profile' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Branch assignment removed' })
  @ApiBadRequestResponse({ description: 'Staff or branch identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile, branch, or assignment was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.staff.scope.manage is required' })
  removeBranch(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @Param('branchId', new ZodValidationPipe(tenantStaffScopeBranchIdSchema))
    branchId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffScopeService['removeBranch']> {
    return this.staffScope.removeBranch(
      context,
      staffId,
      branchId,
      actor,
      this.requestContext(request),
    );
  }

  private requestContext(request: FastifyRequest): TenantStaffScopeAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
