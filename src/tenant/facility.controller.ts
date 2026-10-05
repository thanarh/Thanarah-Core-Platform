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
  createFacilitySchema,
  facilityIdSchema,
  listFacilitiesQuerySchema,
  updateFacilitySchema,
  type CreateFacilityInput,
  type ListFacilitiesQuery,
  type UpdateFacilityInput,
} from './facility.dto';
import { FacilityService, type FacilityRequestAuditContext } from './facility.service';
import type { FacilityRecord } from './facility.repository';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';

@ApiTags('Tenant Facilities')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/facilities`)
export class FacilityController {
  constructor(@Inject(FacilityService) private readonly facilities: FacilityService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.facilities.create')
  @ApiOperation({ summary: 'Create a facility within the trusted tenant' })
  @ApiCreatedResponse({ description: 'Facility created' })
  @ApiBadRequestResponse({ description: 'Facility input is invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  create(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createFacilitySchema)) body: CreateFacilityInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<FacilityRecord> {
    return this.facilities.create(context, body, actor, this.requestContext(request));
  }

  @Get()
  @RequireTenantPermissions('tenant.facilities.read')
  @ApiOperation({ summary: 'List facilities belonging to the trusted tenant' })
  @ApiOkResponse({ description: 'Tenant facilities returned' })
  @ApiBadRequestResponse({ description: 'Facility list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listFacilitiesQuerySchema)) query: ListFacilitiesQuery,
  ): ReturnType<FacilityService['list']> {
    return this.facilities.list(context, query);
  }

  @Get(':facilityId')
  @RequireTenantPermissions('tenant.facilities.read')
  @ApiOperation({ summary: 'Get a facility within the trusted tenant' })
  @ApiOkResponse({ description: 'Facility returned' })
  @ApiBadRequestResponse({ description: 'Facility identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Facility was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'An active tenant membership and permission are required' })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilityIdSchema)) facilityId: string,
  ): ReturnType<FacilityService['findById']> {
    return this.facilities.findById(context, facilityId);
  }

  @Patch(':facilityId')
  @RequireTenantPermissions('tenant.facilities.update')
  @ApiOperation({ summary: 'Update tenant facility details' })
  @ApiOkResponse({ description: 'Facility updated' })
  @ApiBadRequestResponse({ description: 'Facility identifier or input is invalid' })
  @ApiNotFoundResponse({ description: 'Facility was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant facility update permission is required' })
  update(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilityIdSchema)) facilityId: string,
    @Body(new ZodValidationPipe(updateFacilitySchema)) body: UpdateFacilityInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<FacilityRecord> {
    return this.facilities.update(context, facilityId, body, actor, this.requestContext(request));
  }

  @Post(':facilityId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.facilities.suspend')
  @ApiOperation({ summary: 'Suspend an active tenant facility' })
  @ApiOkResponse({ description: 'Facility suspended' })
  @ApiBadRequestResponse({ description: 'Facility identifier is invalid' })
  @ApiConflictResponse({ description: 'Facility lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Facility was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant facility suspend permission is required' })
  suspend(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilityIdSchema)) facilityId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<FacilityRecord> {
    return this.facilities.suspend(context, facilityId, actor, this.requestContext(request));
  }

  @Post(':facilityId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.facilities.activate')
  @ApiOperation({ summary: 'Activate a suspended tenant facility' })
  @ApiOkResponse({ description: 'Facility activated' })
  @ApiBadRequestResponse({ description: 'Facility identifier is invalid' })
  @ApiConflictResponse({ description: 'Facility lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Facility was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant facility activate permission is required' })
  activate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilityIdSchema)) facilityId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<FacilityRecord> {
    return this.facilities.activate(context, facilityId, actor, this.requestContext(request));
  }

  @Post(':facilityId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.facilities.deactivate')
  @ApiOperation({ summary: 'Permanently deactivate a tenant facility' })
  @ApiOkResponse({ description: 'Facility deactivated' })
  @ApiBadRequestResponse({ description: 'Facility identifier is invalid' })
  @ApiConflictResponse({ description: 'Facility lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Facility was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant facility deactivate permission is required' })
  deactivate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilityIdSchema)) facilityId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): Promise<FacilityRecord> {
    return this.facilities.deactivate(context, facilityId, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): FacilityRequestAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
