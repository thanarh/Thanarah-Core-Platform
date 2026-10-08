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
import { PatientStatus } from './patient.model';
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
  createPatientSchema,
  listPatientsQuerySchema,
  MAX_PATIENT_LIST_OFFSET,
  MAX_PATIENT_SEARCH_LENGTH,
  patientIdSchema,
  patientNumberSchema,
  updatePatientSchema,
  type CreatePatientInput,
  type ListPatientsQuery,
  type UpdatePatientInput,
} from './patient.dto';
import {
  CreatePatientRequestDto,
  PatientConflictResponseDto,
  PatientListResponseDto,
  PatientResponseDto,
  UpdatePatientRequestDto,
} from './patient.openapi';
import { PatientService, type PatientAuditContext } from './patient.service';

@ApiTags('Tenant Patients')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId`)
export class TenantPatientController {
  constructor(@Inject(PatientService) private readonly patients: PatientService) {}

  @Post('patients')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.patients.manage')
  @ApiOperation({
    summary: 'Create a patient in the trusted tenant',
    description:
      'Patient number is supplied by the client and unique within the tenant. Tenant ownership and ACTIVE status are server-derived. Creation is rejected as PATIENT_DUPLICATE_POSSIBLE when the same tenant has a case-insensitive first/middle/last name match plus the same normalized phone or email, or a first/last name match plus the same UTC date of birth. Phone comparison normalizes NFKC, surrounding/repeated whitespace only; punctuation and the leading plus sign remain significant. Email comparison is NFKC-normalized, trimmed, and lowercased.',
  })
  @ApiBody({ type: CreatePatientRequestDto })
  @ApiCreatedResponse({ type: PatientResponseDto, description: 'Patient created' })
  @ApiBadRequestResponse({ description: 'Patient details are invalid' })
  @ApiConflictResponse({
    type: PatientConflictResponseDto,
    description:
      'PATIENT_NUMBER_CONFLICT or PATIENT_DUPLICATE_POSSIBLE. Possible duplicate responses include no matching patient details.',
  })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.patients.manage is required' })
  create(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createPatientSchema)) body: CreatePatientInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PatientService['create']> {
    return this.patients.create(context, body, actor, this.requestContext(request));
  }

  @Get('patients')
  @RequireTenantPermissions('tenant.patients.read')
  @ApiOperation({
    summary: 'Search and list patients in the trusted tenant',
    description:
      'Returns ACTIVE and INACTIVE patients by default. Optional status and exact patientNumber filters are tenant-scoped. Search is a case-insensitive literal substring over patientNumber, firstName, middleName, lastName, preferredName, phone, and email; input is NFKC-normalized, trimmed, whitespace-collapsed, and limited to 100 characters. Empty or whitespace-only search adds no filter. National ID, address, and date of birth are not searched or returned in directory entries. Substring matching uses escaped Mongo regular expressions and is not supported by the existing B-tree indexes. Pagination uses bounded limit/offset and results are ordered by createdAt descending then ID descending.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    maxLength: MAX_PATIENT_SEARCH_LENGTH,
    description:
      'Case-insensitive literal substring over patientNumber, firstName, middleName, lastName, preferredName, phone, and email. NFKC-normalized; surrounding and repeated whitespace is normalized. Empty or whitespace-only input is treated as no search filter.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: PatientStatus,
    description: 'Optional lifecycle filter. Omitted status includes all lifecycle states.',
  })
  @ApiQuery({
    name: 'patientNumber',
    required: false,
    type: String,
    maxLength: 64,
    description: 'Exact patient number match within the trusted tenant.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
    description: 'Maximum patients to return; defaults to 50.',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    minimum: 0,
    maximum: MAX_PATIENT_LIST_OFFSET,
    description: 'Number of matching patients to skip; defaults to 0.',
  })
  @ApiOkResponse({ type: PatientListResponseDto })
  @ApiBadRequestResponse({ description: 'Patient list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.patients.read is required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listPatientsQuerySchema)) query: ListPatientsQuery,
  ): ReturnType<PatientService['list']> {
    return this.patients.list(context, query);
  }

  @Get('patients/by-number/:patientNumber')
  @RequireTenantPermissions('tenant.patients.read')
  @ApiOperation({
    summary: 'Get a patient by exact number within the trusted tenant',
    description:
      'Uses an exact, case-sensitive patientNumber match after NFKC normalization and trimming. The lookup is tenant-scoped and requires tenant.patients.read.',
  })
  @ApiParam({
    name: 'patientNumber',
    schema: { type: 'string', minLength: 1, maxLength: 64 },
    description: 'Exact patient number within the trusted tenant.',
  })
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiBadRequestResponse({ description: 'Patient number is invalid' })
  @ApiNotFoundResponse({ description: 'Patient was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.patients.read is required' })
  findByPatientNumber(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('patientNumber', new ZodValidationPipe(patientNumberSchema)) patientNumber: string,
  ): ReturnType<PatientService['findByPatientNumber']> {
    return this.patients.findByPatientNumber(context, patientNumber);
  }

  @Get('patients/:patientId')
  @RequireTenantPermissions('tenant.patients.read')
  @ApiOperation({ summary: 'Get one patient in the trusted tenant' })
  @ApiParam({ name: 'patientId', format: 'uuid' })
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiBadRequestResponse({ description: 'Patient identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Patient was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.patients.read is required' })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('patientId', new ZodValidationPipe(patientIdSchema)) patientId: string,
  ): ReturnType<PatientService['findById']> {
    return this.patients.findById(context, patientId);
  }

  @Patch('patients/:patientId')
  @RequireTenantPermissions('tenant.patients.manage')
  @ApiOperation({
    summary: 'Update patient demographic and contact details',
    description:
      'Only supplied mutable fields are changed. Send null to clear nullable values. Tenant ownership, ID, status, and timestamps cannot be changed here. Changes to first/middle/last name, phone, email, or date of birth are rejected as PATIENT_DUPLICATE_POSSIBLE when another patient in the same tenant matches the deterministic duplicate rules. The current patient is excluded.',
  })
  @ApiParam({ name: 'patientId', format: 'uuid' })
  @ApiBody({ type: UpdatePatientRequestDto })
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiBadRequestResponse({ description: 'Patient details or identifier are invalid' })
  @ApiConflictResponse({
    type: PatientConflictResponseDto,
    description:
      'PATIENT_NUMBER_CONFLICT or PATIENT_DUPLICATE_POSSIBLE. Possible duplicate responses include no matching patient details.',
  })
  @ApiNotFoundResponse({ description: 'Patient was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.patients.manage is required' })
  update(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('patientId', new ZodValidationPipe(patientIdSchema)) patientId: string,
    @Body(new ZodValidationPipe(updatePatientSchema)) body: UpdatePatientInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PatientService['update']> {
    return this.patients.update(context, patientId, body, actor, this.requestContext(request));
  }

  @Post('patients/:patientId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.patients.manage')
  @ApiOperation({ summary: 'Activate an inactive patient' })
  @ApiParam({ name: 'patientId', format: 'uuid' })
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiBadRequestResponse({ description: 'Patient identifier is invalid' })
  @ApiConflictResponse({ description: 'The patient status changed concurrently' })
  @ApiNotFoundResponse({ description: 'Patient was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.patients.manage is required' })
  activate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('patientId', new ZodValidationPipe(patientIdSchema)) patientId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PatientService['activate']> {
    return this.patients.activate(context, patientId, actor, this.requestContext(request));
  }

  @Post('patients/:patientId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.patients.manage')
  @ApiOperation({ summary: 'Mark an active patient inactive' })
  @ApiParam({ name: 'patientId', format: 'uuid' })
  @ApiOkResponse({ type: PatientResponseDto })
  @ApiBadRequestResponse({ description: 'Patient identifier is invalid' })
  @ApiConflictResponse({ description: 'The patient status changed concurrently' })
  @ApiNotFoundResponse({ description: 'Patient was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'tenant.patients.manage is required' })
  deactivate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('patientId', new ZodValidationPipe(patientIdSchema)) patientId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PatientService['deactivate']> {
    return this.patients.deactivate(context, patientId, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): PatientAuditContext {
    const userAgent = request.headers['user-agent'];
    return {
      requestId: request.id,
      ipAddress: request.ip,
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
    };
  }
}
