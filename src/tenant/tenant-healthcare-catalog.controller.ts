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
import { TenantCatalogStatus } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantContextGuard } from './tenant-context.guard';
import {
  createHealthcareCatalogSchema,
  healthcareCatalogIdSchema,
  listHealthcareCatalogQuerySchema,
  updateHealthcareCatalogSchema,
  type CreateHealthcareCatalogInput,
  type ListHealthcareCatalogQuery,
  type UpdateHealthcareCatalogInput,
} from './healthcare-catalog.dto';
import {
  CreateHealthcareCatalogRequestDto,
  DepartmentListResponseDto,
  DepartmentResponseDto,
  SpecialtyListResponseDto,
  SpecialtyResponseDto,
  UpdateHealthcareCatalogRequestDto,
} from './healthcare-catalog.openapi';
import {
  HealthcareCatalogService,
  type HealthcareCatalogAuditContext,
} from './healthcare-catalog.service';

@ApiTags('Tenant Healthcare Catalog')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId`)
export class TenantHealthcareCatalogController {
  constructor(
    @Inject(HealthcareCatalogService) private readonly catalogs: HealthcareCatalogService,
  ) {}

  @Post('departments')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.departments.manage')
  @ApiOperation({
    summary: 'Create a department in the trusted tenant catalog',
    description:
      'The route tenant must match TrustedTenantContext. Ownership is server-derived; the body accepts only name and optional description.',
  })
  @ApiBody({ type: CreateHealthcareCatalogRequestDto })
  @ApiCreatedResponse({ type: DepartmentResponseDto, description: 'Department created' })
  @ApiBadRequestResponse({ description: 'Department details are invalid' })
  @ApiConflictResponse({ description: 'A department with the normalized name already exists' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.departments.manage is required' })
  createDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createHealthcareCatalogSchema)) body: CreateHealthcareCatalogInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['create']> {
    return this.catalogs.create('department', context, body, actor, this.requestContext(request));
  }

  @Get('departments')
  @RequireTenantPermissions('tenant.departments.read')
  @ApiOperation({
    summary: 'List departments in the trusted tenant',
    description:
      'Returns active, suspended, and deactivated records by default. Use status to filter; tenantId is validated against TrustedTenantContext.',
  })
  @ApiQuery({ name: 'status', required: false, enum: TenantCatalogStatus })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ type: DepartmentListResponseDto })
  @ApiBadRequestResponse({ description: 'Department list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.departments.read is required' })
  listDepartments(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listHealthcareCatalogQuerySchema))
    query: ListHealthcareCatalogQuery,
  ): ReturnType<HealthcareCatalogService['list']> {
    return this.catalogs.list('department', context, query);
  }

  @Get('departments/:departmentId')
  @RequireTenantPermissions('tenant.departments.read')
  @ApiOperation({ summary: 'Get one department in the trusted tenant' })
  @ApiParam({ name: 'departmentId', format: 'uuid' })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @ApiBadRequestResponse({ description: 'Department identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Department was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.departments.read is required' })
  findDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('departmentId', new ZodValidationPipe(healthcareCatalogIdSchema))
    departmentId: string,
  ): ReturnType<HealthcareCatalogService['findById']> {
    return this.catalogs.findById('department', context, departmentId);
  }

  @Patch('departments/:departmentId')
  @RequireTenantPermissions('tenant.departments.manage')
  @ApiOperation({
    summary: 'Update department name or description',
    description:
      'Status and tenant ownership can only be changed through their dedicated controls.',
  })
  @ApiParam({ name: 'departmentId', format: 'uuid' })
  @ApiBody({ type: UpdateHealthcareCatalogRequestDto })
  @ApiOkResponse({ type: DepartmentResponseDto, description: 'Department updated' })
  @ApiBadRequestResponse({ description: 'Department identifier or details are invalid' })
  @ApiConflictResponse({ description: 'A department with the normalized name already exists' })
  @ApiNotFoundResponse({ description: 'Department was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.departments.manage is required' })
  updateDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('departmentId', new ZodValidationPipe(healthcareCatalogIdSchema))
    departmentId: string,
    @Body(new ZodValidationPipe(updateHealthcareCatalogSchema))
    body: UpdateHealthcareCatalogInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['update']> {
    return this.catalogs.update(
      'department',
      context,
      departmentId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('departments/:departmentId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.departments.manage')
  @ApiOperation({ summary: 'Activate a suspended department' })
  @ApiParam({ name: 'departmentId', format: 'uuid' })
  @ApiOkResponse({ type: DepartmentResponseDto, description: 'Department activated' })
  @ApiBadRequestResponse({ description: 'Department identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Department was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.departments.manage is required' })
  activateDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('departmentId', new ZodValidationPipe(healthcareCatalogIdSchema))
    departmentId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['activate']> {
    return this.catalogs.activate(
      'department',
      context,
      departmentId,
      actor,
      this.requestContext(request),
    );
  }

  @Post('departments/:departmentId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.departments.manage')
  @ApiOperation({ summary: 'Suspend an active department' })
  @ApiParam({ name: 'departmentId', format: 'uuid' })
  @ApiOkResponse({ type: DepartmentResponseDto, description: 'Department suspended' })
  @ApiBadRequestResponse({ description: 'Department identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Department was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.departments.manage is required' })
  suspendDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('departmentId', new ZodValidationPipe(healthcareCatalogIdSchema))
    departmentId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['suspend']> {
    return this.catalogs.suspend(
      'department',
      context,
      departmentId,
      actor,
      this.requestContext(request),
    );
  }

  @Post('departments/:departmentId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.departments.manage')
  @ApiOperation({ summary: 'Permanently deactivate a department' })
  @ApiParam({ name: 'departmentId', format: 'uuid' })
  @ApiOkResponse({ type: DepartmentResponseDto, description: 'Department deactivated' })
  @ApiBadRequestResponse({ description: 'Department identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Department was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.departments.manage is required' })
  deactivateDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('departmentId', new ZodValidationPipe(healthcareCatalogIdSchema))
    departmentId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['deactivate']> {
    return this.catalogs.deactivate(
      'department',
      context,
      departmentId,
      actor,
      this.requestContext(request),
    );
  }

  @Post('specialties')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.specialties.manage')
  @ApiOperation({
    summary: 'Create a specialty in the trusted tenant catalog',
    description:
      'The route tenant must match TrustedTenantContext. Ownership is server-derived; the body accepts only name and optional description.',
  })
  @ApiBody({ type: CreateHealthcareCatalogRequestDto })
  @ApiCreatedResponse({ type: SpecialtyResponseDto, description: 'Specialty created' })
  @ApiBadRequestResponse({ description: 'Specialty details are invalid' })
  @ApiConflictResponse({ description: 'A specialty with the normalized name already exists' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.specialties.manage is required' })
  createSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createHealthcareCatalogSchema)) body: CreateHealthcareCatalogInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['create']> {
    return this.catalogs.create('specialty', context, body, actor, this.requestContext(request));
  }

  @Get('specialties')
  @RequireTenantPermissions('tenant.specialties.read')
  @ApiOperation({
    summary: 'List specialties in the trusted tenant',
    description:
      'Returns active, suspended, and deactivated records by default. Use status to filter; tenantId is validated against TrustedTenantContext.',
  })
  @ApiQuery({ name: 'status', required: false, enum: TenantCatalogStatus })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ type: SpecialtyListResponseDto })
  @ApiBadRequestResponse({ description: 'Specialty list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.specialties.read is required' })
  listSpecialties(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listHealthcareCatalogQuerySchema))
    query: ListHealthcareCatalogQuery,
  ): ReturnType<HealthcareCatalogService['list']> {
    return this.catalogs.list('specialty', context, query);
  }

  @Get('specialties/:specialtyId')
  @RequireTenantPermissions('tenant.specialties.read')
  @ApiOperation({ summary: 'Get one specialty in the trusted tenant' })
  @ApiParam({ name: 'specialtyId', format: 'uuid' })
  @ApiOkResponse({ type: SpecialtyResponseDto })
  @ApiBadRequestResponse({ description: 'Specialty identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Specialty was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.specialties.read is required' })
  findSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('specialtyId', new ZodValidationPipe(healthcareCatalogIdSchema))
    specialtyId: string,
  ): ReturnType<HealthcareCatalogService['findById']> {
    return this.catalogs.findById('specialty', context, specialtyId);
  }

  @Patch('specialties/:specialtyId')
  @RequireTenantPermissions('tenant.specialties.manage')
  @ApiOperation({
    summary: 'Update specialty name or description',
    description:
      'Status and tenant ownership can only be changed through their dedicated controls.',
  })
  @ApiParam({ name: 'specialtyId', format: 'uuid' })
  @ApiBody({ type: UpdateHealthcareCatalogRequestDto })
  @ApiOkResponse({ type: SpecialtyResponseDto, description: 'Specialty updated' })
  @ApiBadRequestResponse({ description: 'Specialty identifier or details are invalid' })
  @ApiConflictResponse({ description: 'A specialty with the normalized name already exists' })
  @ApiNotFoundResponse({ description: 'Specialty was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.specialties.manage is required' })
  updateSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('specialtyId', new ZodValidationPipe(healthcareCatalogIdSchema))
    specialtyId: string,
    @Body(new ZodValidationPipe(updateHealthcareCatalogSchema))
    body: UpdateHealthcareCatalogInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['update']> {
    return this.catalogs.update(
      'specialty',
      context,
      specialtyId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('specialties/:specialtyId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.specialties.manage')
  @ApiOperation({ summary: 'Activate a suspended specialty' })
  @ApiParam({ name: 'specialtyId', format: 'uuid' })
  @ApiOkResponse({ type: SpecialtyResponseDto, description: 'Specialty activated' })
  @ApiBadRequestResponse({ description: 'Specialty identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Specialty was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.specialties.manage is required' })
  activateSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('specialtyId', new ZodValidationPipe(healthcareCatalogIdSchema))
    specialtyId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['activate']> {
    return this.catalogs.activate(
      'specialty',
      context,
      specialtyId,
      actor,
      this.requestContext(request),
    );
  }

  @Post('specialties/:specialtyId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.specialties.manage')
  @ApiOperation({ summary: 'Suspend an active specialty' })
  @ApiParam({ name: 'specialtyId', format: 'uuid' })
  @ApiOkResponse({ type: SpecialtyResponseDto, description: 'Specialty suspended' })
  @ApiBadRequestResponse({ description: 'Specialty identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Specialty was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.specialties.manage is required' })
  suspendSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('specialtyId', new ZodValidationPipe(healthcareCatalogIdSchema))
    specialtyId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['suspend']> {
    return this.catalogs.suspend(
      'specialty',
      context,
      specialtyId,
      actor,
      this.requestContext(request),
    );
  }

  @Post('specialties/:specialtyId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.specialties.manage')
  @ApiOperation({ summary: 'Permanently deactivate a specialty' })
  @ApiParam({ name: 'specialtyId', format: 'uuid' })
  @ApiOkResponse({ type: SpecialtyResponseDto, description: 'Specialty deactivated' })
  @ApiBadRequestResponse({ description: 'Specialty identifier is invalid' })
  @ApiConflictResponse({
    description: 'Transition from the current state is invalid; same-state requests are idempotent',
  })
  @ApiNotFoundResponse({ description: 'Specialty was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.specialties.manage is required' })
  deactivateSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('specialtyId', new ZodValidationPipe(healthcareCatalogIdSchema))
    specialtyId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<HealthcareCatalogService['deactivate']> {
    return this.catalogs.deactivate(
      'specialty',
      context,
      specialtyId,
      actor,
      this.requestContext(request),
    );
  }

  private requestContext(request: FastifyRequest): HealthcareCatalogAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
