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
import { StaffStatus } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import {
  createDoctorSchema,
  doctorDepartmentAssignmentSchema,
  doctorIdSchema,
  doctorSpecialtyAssignmentSchema,
  listDoctorsQuerySchema,
  updateDoctorSchema,
  type CreateDoctorInput,
  type DoctorDepartmentAssignmentInput,
  type DoctorSpecialtyAssignmentInput,
  type ListDoctorsQuery,
  type UpdateDoctorInput,
} from './doctor.dto';
import {
  AssignDoctorDepartmentRequestDto,
  AssignDoctorSpecialtyRequestDto,
  CreateDoctorRequestDto,
  DoctorDepartmentListResponseDto,
  DoctorListResponseDto,
  DoctorResponseDto,
  DoctorSpecialtyListResponseDto,
  UpdateDoctorRequestDto,
} from './doctor.openapi';
import { DoctorService, type DoctorAuditContext } from './doctor.service';

@ApiTags('Tenant Doctors')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/doctors`)
export class DoctorController {
  constructor(@Inject(DoctorService) private readonly doctors: DoctorService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({
    summary: 'Create a Doctor profile for an active Staff profile',
    description:
      'Doctor identity and tenant ownership are derived from the existing Staff profile and trusted tenant context. Optional department and specialty IDs must identify active catalog entries in the same tenant.',
  })
  @ApiBody({ type: CreateDoctorRequestDto })
  @ApiCreatedResponse({ type: DoctorResponseDto, description: 'Doctor profile created' })
  @ApiBadRequestResponse({ description: 'Staff identifier or Doctor details are invalid' })
  @ApiConflictResponse({
    description:
      'The tenant is inactive, Staff is ineligible, or Staff already has a Doctor profile',
  })
  @ApiNotFoundResponse({
    description: 'Staff or an active same-tenant Department/Specialty was not found',
  })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and Doctor manage permission are required',
  })
  create(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createDoctorSchema)) body: CreateDoctorInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['create']> {
    return this.doctors.create(context, body, actor, this.requestContext(request));
  }

  @Get()
  @RequireTenantPermissions('tenant.doctors.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'List Doctor profiles in the trusted tenant' })
  @ApiQuery({ name: 'status', required: false, enum: StaffStatus })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ type: DoctorListResponseDto, description: 'Tenant Doctors returned' })
  @ApiBadRequestResponse({ description: 'Doctor list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and Doctor read permission are required',
  })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listDoctorsQuerySchema)) query: ListDoctorsQuery,
  ): ReturnType<DoctorService['list']> {
    return this.doctors.list(context, query);
  }

  @Get(':doctorId')
  @RequireTenantPermissions('tenant.doctors.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({
    summary: 'Get a Doctor profile and its Department/Specialty assignments',
    description:
      'operationallyActive is true only when the tenant, Staff profile, and Doctor profile are all ACTIVE.',
  })
  @ApiOkResponse({ type: DoctorResponseDto, description: 'Doctor profile returned' })
  @ApiBadRequestResponse({ description: 'Doctor identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Doctor profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and Doctor read permission are required',
  })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
  ): ReturnType<DoctorService['findById']> {
    return this.doctors.findById(context, doctorId);
  }

  @Patch(':doctorId')
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({
    summary: 'Update the optional professional display name',
    description:
      'Staff identity, tenant ownership, and lifecycle status are immutable in this route.',
  })
  @ApiBody({ type: UpdateDoctorRequestDto })
  @ApiOkResponse({ type: DoctorResponseDto, description: 'Doctor profile updated' })
  @ApiBadRequestResponse({ description: 'Doctor identifier or profile changes are invalid' })
  @ApiNotFoundResponse({ description: 'Doctor profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and Doctor manage permission are required',
  })
  update(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @Body(new ZodValidationPipe(updateDoctorSchema)) body: UpdateDoctorInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['update']> {
    return this.doctors.update(context, doctorId, body, actor, this.requestContext(request));
  }

  @Post(':doctorId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Activate a suspended Doctor profile' })
  @ApiOkResponse({ type: DoctorResponseDto, description: 'Doctor profile activated' })
  @ApiBadRequestResponse({ description: 'Doctor identifier is invalid' })
  @ApiConflictResponse({ description: 'Deactivated Doctors cannot be reactivated' })
  @ApiNotFoundResponse({ description: 'Doctor profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Doctor manage permission is required' })
  activate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['activate']> {
    return this.doctors.activate(context, doctorId, actor, this.requestContext(request));
  }

  @Post(':doctorId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Suspend an active Doctor profile' })
  @ApiOkResponse({ type: DoctorResponseDto, description: 'Doctor profile suspended' })
  @ApiBadRequestResponse({ description: 'Doctor identifier is invalid' })
  @ApiConflictResponse({ description: 'The requested lifecycle transition is invalid' })
  @ApiNotFoundResponse({ description: 'Doctor profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Doctor manage permission is required' })
  suspend(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['suspend']> {
    return this.doctors.suspend(context, doctorId, actor, this.requestContext(request));
  }

  @Post(':doctorId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Permanently deactivate an active or suspended Doctor profile' })
  @ApiOkResponse({ type: DoctorResponseDto, description: 'Doctor profile deactivated' })
  @ApiBadRequestResponse({ description: 'Doctor identifier is invalid' })
  @ApiConflictResponse({ description: 'The requested lifecycle transition is invalid' })
  @ApiNotFoundResponse({ description: 'Doctor profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Doctor manage permission is required' })
  deactivate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['deactivate']> {
    return this.doctors.deactivate(context, doctorId, actor, this.requestContext(request));
  }

  @Get(':doctorId/departments')
  @RequireTenantPermissions('tenant.doctors.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'List Departments assigned to a Doctor' })
  @ApiOkResponse({ type: DoctorDepartmentListResponseDto })
  @ApiBadRequestResponse({ description: 'Doctor identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Doctor profile was not found in this tenant' })
  listDepartments(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
  ): ReturnType<DoctorService['listDepartments']> {
    return this.doctors.listDepartments(context, doctorId);
  }

  @Post(':doctorId/departments')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Assign an active same-tenant Department to a Doctor' })
  @ApiBody({ type: AssignDoctorDepartmentRequestDto })
  @ApiCreatedResponse({ type: DoctorResponseDto })
  @ApiBadRequestResponse({ description: 'Doctor or Department identifier is invalid' })
  @ApiConflictResponse({ description: 'Department is already assigned or Doctor is deactivated' })
  @ApiNotFoundResponse({
    description: 'Doctor or active same-tenant Department was not found',
  })
  assignDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @Body(new ZodValidationPipe(doctorDepartmentAssignmentSchema))
    body: DoctorDepartmentAssignmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['assignDepartment']> {
    return this.doctors.assignDepartment(
      context,
      doctorId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Delete(':doctorId/departments/:departmentId')
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiParam({ name: 'departmentId', description: 'Department identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a Department assignment without deleting the Doctor' })
  @ApiOkResponse({ type: DoctorResponseDto })
  @ApiBadRequestResponse({ description: 'Doctor or Department identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Doctor or Department assignment was not found' })
  unassignDepartment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @Param('departmentId', new ZodValidationPipe(doctorIdSchema)) departmentId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['unassignDepartment']> {
    return this.doctors.unassignDepartment(
      context,
      doctorId,
      departmentId,
      actor,
      this.requestContext(request),
    );
  }

  @Get(':doctorId/specialties')
  @RequireTenantPermissions('tenant.doctors.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'List Specialties assigned to a Doctor' })
  @ApiOkResponse({ type: DoctorSpecialtyListResponseDto })
  @ApiBadRequestResponse({ description: 'Doctor identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Doctor profile was not found in this tenant' })
  listSpecialties(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
  ): ReturnType<DoctorService['listSpecialties']> {
    return this.doctors.listSpecialties(context, doctorId);
  }

  @Post(':doctorId/specialties')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Assign an active same-tenant Specialty to a Doctor' })
  @ApiBody({ type: AssignDoctorSpecialtyRequestDto })
  @ApiCreatedResponse({ type: DoctorResponseDto })
  @ApiBadRequestResponse({ description: 'Doctor or Specialty identifier is invalid' })
  @ApiConflictResponse({ description: 'Specialty is already assigned or Doctor is deactivated' })
  @ApiNotFoundResponse({
    description: 'Doctor or active same-tenant Specialty was not found',
  })
  assignSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @Body(new ZodValidationPipe(doctorSpecialtyAssignmentSchema))
    body: DoctorSpecialtyAssignmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['assignSpecialty']> {
    return this.doctors.assignSpecialty(
      context,
      doctorId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Delete(':doctorId/specialties/:specialtyId')
  @RequireTenantPermissions('tenant.doctors.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'doctorId', description: 'Doctor profile identifier', format: 'uuid' })
  @ApiParam({ name: 'specialtyId', description: 'Specialty identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a Specialty assignment without deleting the Doctor' })
  @ApiOkResponse({ type: DoctorResponseDto })
  @ApiBadRequestResponse({ description: 'Doctor or Specialty identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Doctor or Specialty assignment was not found' })
  unassignSpecialty(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('doctorId', new ZodValidationPipe(doctorIdSchema)) doctorId: string,
    @Param('specialtyId', new ZodValidationPipe(doctorIdSchema)) specialtyId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<DoctorService['unassignSpecialty']> {
    return this.doctors.unassignSpecialty(
      context,
      doctorId,
      specialtyId,
      actor,
      this.requestContext(request),
    );
  }

  private requestContext(request: FastifyRequest): DoctorAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
