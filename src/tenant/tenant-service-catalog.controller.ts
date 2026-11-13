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
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TenantCatalogStatus } from '../common/domain-enums';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import {
  createServiceSchema,
  listServicesQuerySchema,
  MAX_SERVICE_LIST_OFFSET,
  serviceIdSchema,
  updateServiceSchema,
  type CreateServiceInput,
  type ListServicesQuery,
  type UpdateServiceInput,
} from './service-catalog.dto';
import {
  CreateServiceRequestDto,
  ServiceListResponseDto,
  ServiceResponseDto,
  UpdateServiceRequestDto,
} from './service-catalog.openapi';
import { ServiceCatalogService, type ServiceCatalogAuditContext } from './service-catalog.service';

@ApiTags('Tenant Service Catalog')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId`)
export class TenantServiceCatalogController {
  constructor(@Inject(ServiceCatalogService) private readonly services: ServiceCatalogService) {}

  @Post('services')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.services.manage')
  @ApiOperation({
    summary: 'Create a service in the trusted tenant catalog',
    description:
      'Ownership and lifecycle status are server-derived. The body accepts only name, optional tenant-unique code, and optional plain-text description.',
  })
  @ApiBody({ type: CreateServiceRequestDto })
  @ApiCreatedResponse({ type: ServiceResponseDto, description: 'Service created' })
  @ApiBadRequestResponse({ description: 'Service details are invalid' })
  @ApiConflictResponse({ description: 'The service name or code already exists in the tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.services.manage is required' })
  create(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createServiceSchema)) body: CreateServiceInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<ServiceCatalogService['create']> {
    return this.services.create(context, body, actor, this.requestContext(request));
  }

  @Get('services')
  @RequireTenantPermissions('tenant.services.read')
  @ApiOperation({
    summary: 'List services in the trusted tenant',
    description:
      'Returns active, suspended, and deactivated services by default. Use status to filter. Pagination uses limit/offset, and results are ordered by createdAt descending then id descending. Tenant scope comes from TrustedTenantContext.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: TenantCatalogStatus,
    description: 'Optional lifecycle filter. Omitted status includes all lifecycle states.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
    description: 'Maximum services to return; defaults to 50.',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    minimum: 0,
    maximum: MAX_SERVICE_LIST_OFFSET,
    description: 'Number of matching services to skip; defaults to 0.',
  })
  @ApiOkResponse({ type: ServiceListResponseDto })
  @ApiBadRequestResponse({ description: 'Service list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.services.read is required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listServicesQuerySchema)) query: ListServicesQuery,
  ): ReturnType<ServiceCatalogService['list']> {
    return this.services.list(context, query);
  }

  @Get('services/:serviceId')
  @RequireTenantPermissions('tenant.services.read')
  @ApiOperation({ summary: 'Get one service in the trusted tenant' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOkResponse({ type: ServiceResponseDto })
  @ApiBadRequestResponse({ description: 'Service identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Service was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.services.read is required' })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('serviceId', new ZodValidationPipe(serviceIdSchema)) serviceId: string,
  ): ReturnType<ServiceCatalogService['findById']> {
    return this.services.findById(context, serviceId);
  }

  @Patch('services/:serviceId')
  @RequireTenantPermissions('tenant.services.manage')
  @ApiOperation({
    summary: 'Update service name, code, or description',
    description:
      'Ownership and status cannot be changed through this endpoint; null clears code or description.',
  })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiBody({ type: UpdateServiceRequestDto })
  @ApiOkResponse({ type: ServiceResponseDto, description: 'Service updated' })
  @ApiBadRequestResponse({ description: 'Service identifier or details are invalid' })
  @ApiConflictResponse({ description: 'The service name or code already exists in the tenant' })
  @ApiNotFoundResponse({ description: 'Service was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.services.manage is required' })
  update(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('serviceId', new ZodValidationPipe(serviceIdSchema)) serviceId: string,
    @Body(new ZodValidationPipe(updateServiceSchema)) body: UpdateServiceInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<ServiceCatalogService['update']> {
    return this.services.update(context, serviceId, body, actor, this.requestContext(request));
  }

  @Post('services/:serviceId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.services.manage')
  @ApiOperation({ summary: 'Activate a suspended service' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOkResponse({ type: ServiceResponseDto, description: 'Service activated' })
  @ApiBadRequestResponse({ description: 'Service identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Service was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.services.manage is required' })
  activate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('serviceId', new ZodValidationPipe(serviceIdSchema)) serviceId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<ServiceCatalogService['activate']> {
    return this.services.activate(context, serviceId, actor, this.requestContext(request));
  }

  @Post('services/:serviceId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.services.manage')
  @ApiOperation({ summary: 'Suspend an active service' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOkResponse({ type: ServiceResponseDto, description: 'Service suspended' })
  @ApiBadRequestResponse({ description: 'Service identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Service was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.services.manage is required' })
  suspend(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('serviceId', new ZodValidationPipe(serviceIdSchema)) serviceId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<ServiceCatalogService['suspend']> {
    return this.services.suspend(context, serviceId, actor, this.requestContext(request));
  }

  @Post('services/:serviceId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.services.manage')
  @ApiOperation({ summary: 'Permanently deactivate a service' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @ApiOkResponse({ type: ServiceResponseDto, description: 'Service deactivated' })
  @ApiBadRequestResponse({ description: 'Service identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Service was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.services.manage is required' })
  deactivate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('serviceId', new ZodValidationPipe(serviceIdSchema)) serviceId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<ServiceCatalogService['deactivate']> {
    return this.services.deactivate(context, serviceId, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): ServiceCatalogAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
