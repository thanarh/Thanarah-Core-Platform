import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  branchFacilityIdSchema,
  branchIdSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
  type CreateBranchInput,
  type ListBranchesQuery,
  type UpdateBranchInput,
} from './branch.dto';
import { BranchService, type BranchRequestAuditContext } from './branch.service';
import type { BranchRecord } from './branch.repository';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';

@ApiTags('Tenant Branches')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/facilities/:facilityId/branches`)
export class BranchController {
  constructor(@Inject(BranchService) private readonly branches: BranchService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.branches.create')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'Create a Branch under a Facility in the trusted tenant' })
  @ApiCreatedResponse({ description: 'Branch created' })
  @ApiBadRequestResponse({ description: 'Facility identifier or Branch input is invalid' })
  @ApiConflictResponse({ description: 'Tenant or parent Facility is not active' })
  @ApiNotFoundResponse({ description: 'Facility was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  create(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(branchFacilityIdSchema)) facilityId: string,
    @Body(new ZodValidationPipe(createBranchSchema)) body: CreateBranchInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<BranchRecord> {
    return this.branches.create(context, facilityId, body, actor, this.requestContext(request));
  }

  @Get()
  @RequireTenantPermissions('tenant.branches.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'List Branches under a Facility in the trusted tenant' })
  @ApiOkResponse({ description: 'Facility Branches returned' })
  @ApiBadRequestResponse({ description: 'Facility identifier or list filters are invalid' })
  @ApiConflictResponse({ description: 'Tenant or parent Facility is not active' })
  @ApiNotFoundResponse({ description: 'Facility was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(branchFacilityIdSchema)) facilityId: string,
    @Query(new ZodValidationPipe(listBranchesQuerySchema)) query: ListBranchesQuery,
  ): ReturnType<BranchService['list']> {
    return this.branches.list(context, facilityId, query);
  }

  @Get(':branchId')
  @RequireTenantPermissions('tenant.branches.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'Get a Branch within the requested Facility and tenant' })
  @ApiOkResponse({ description: 'Branch returned' })
  @ApiBadRequestResponse({ description: 'Facility or Branch identifier is invalid' })
  @ApiConflictResponse({ description: 'Tenant or parent Facility is not active' })
  @ApiNotFoundResponse({ description: 'Facility or Branch was not found in the requested scope' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(branchFacilityIdSchema)) facilityId: string,
    @Param('branchId', new ZodValidationPipe(branchIdSchema)) branchId: string,
  ): ReturnType<BranchService['findById']> {
    return this.branches.findById(context, facilityId, branchId);
  }

  @Patch(':branchId')
  @RequireTenantPermissions('tenant.branches.update')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'Update mutable Branch details without changing its Facility' })
  @ApiOkResponse({ description: 'Branch updated' })
  @ApiBadRequestResponse({ description: 'Identifiers or Branch input are invalid' })
  @ApiConflictResponse({ description: 'Tenant or parent Facility is not active' })
  @ApiNotFoundResponse({ description: 'Facility or Branch was not found in the requested scope' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant Branch update permission is required' })
  update(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(branchFacilityIdSchema)) facilityId: string,
    @Param('branchId', new ZodValidationPipe(branchIdSchema)) branchId: string,
    @Body(new ZodValidationPipe(updateBranchSchema)) body: UpdateBranchInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<BranchRecord> {
    return this.branches.update(
      context,
      facilityId,
      branchId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post(':branchId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.branches.suspend')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'Suspend an active Branch' })
  @ApiOkResponse({ description: 'Branch suspended' })
  @ApiBadRequestResponse({ description: 'Facility or Branch identifier is invalid' })
  @ApiConflictResponse({ description: 'Parent scope is unavailable or transition is invalid' })
  @ApiNotFoundResponse({ description: 'Facility or Branch was not found in the requested scope' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant Branch suspend permission is required' })
  suspend(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(branchFacilityIdSchema)) facilityId: string,
    @Param('branchId', new ZodValidationPipe(branchIdSchema)) branchId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<BranchRecord> {
    return this.branches.suspend(
      context,
      facilityId,
      branchId,
      actor,
      this.requestContext(request),
    );
  }

  @Post(':branchId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.branches.activate')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'Activate a suspended Branch' })
  @ApiOkResponse({ description: 'Branch activated' })
  @ApiBadRequestResponse({ description: 'Facility or Branch identifier is invalid' })
  @ApiConflictResponse({ description: 'Parent scope is unavailable or transition is invalid' })
  @ApiNotFoundResponse({ description: 'Facility or Branch was not found in the requested scope' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant Branch activate permission is required' })
  activate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(branchFacilityIdSchema)) facilityId: string,
    @Param('branchId', new ZodValidationPipe(branchIdSchema)) branchId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<BranchRecord> {
    return this.branches.activate(
      context,
      facilityId,
      branchId,
      actor,
      this.requestContext(request),
    );
  }

  @Post(':branchId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.branches.deactivate')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'Permanently deactivate a Branch' })
  @ApiOkResponse({ description: 'Branch deactivated' })
  @ApiBadRequestResponse({ description: 'Facility or Branch identifier is invalid' })
  @ApiConflictResponse({ description: 'Parent scope is unavailable or transition is invalid' })
  @ApiNotFoundResponse({ description: 'Facility or Branch was not found in the requested scope' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant Branch deactivate permission is required' })
  deactivate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(branchFacilityIdSchema)) facilityId: string,
    @Param('branchId', new ZodValidationPipe(branchIdSchema)) branchId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<BranchRecord> {
    return this.branches.deactivate(
      context,
      facilityId,
      branchId,
      actor,
      this.requestContext(request),
    );
  }

  private requestContext(request: FastifyRequest): BranchRequestAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
