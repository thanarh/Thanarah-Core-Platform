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
  Put,
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
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import { TenantContextGuard } from './tenant-context.guard';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import {
  cancelEncounterSchema,
  completeEncounterSchema,
  createDirectEncounterSchema,
  createEncounterFromAppointmentSchema,
  encounterEffectiveTimeZonesQuerySchema,
  encounterIdSchema,
  createEncounterAmendmentSchema,
  finalizeEncounterAmendmentSchema,
  listEncountersQuerySchema,
  replaceEncounterDiagnosesSchema,
  replaceEncounterServiceRecordsSchema,
  updateEncounterAmendmentSchema,
  updateEncounterSchema,
} from './encounter.dto';
import type {
  CancelEncounterInput,
  CompleteEncounterInput,
  CreateEncounterAmendmentInput,
  CreateDirectEncounterInput,
  CreateEncounterFromAppointmentInput,
  EncounterEffectiveTimeZonesQuery,
  FinalizeEncounterAmendmentInput,
  ListEncountersQuery,
  ReplaceEncounterDiagnosesInput,
  ReplaceEncounterServiceRecordsInput,
  UpdateEncounterAmendmentInput,
  UpdateEncounterInput,
} from './encounter.dto';
import { EncounterService } from './encounter.service';
import {
  CancelEncounterRequestDto,
  CreateDirectEncounterRequestDto,
  CreateEncounterAmendmentRequestDto,
  CreateEncounterFromAppointmentRequestDto,
  EncounterErrorResponseDto,
  EncounterListResponseDto,
  EncounterResponseDto,
  PatientEncounterHistoryResponseDto,
  ReplaceEncounterDiagnosesRequestDto,
  ReplaceEncounterServiceRecordsRequestDto,
  UpdateEncounterRequestDto,
  UpdateEncounterAmendmentRequestDto,
} from './encounter.openapi';

@ApiTags('Tenant Medical Encounters')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId`)
export class TenantEncounterController {
  constructor(
    @Inject(EncounterService)
    private readonly encounters: EncounterService,
  ) {}

  @Post('encounters/from-appointment')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.encounters.create', 'tenant.appointments.read')
  @ApiOperation({
    summary: 'Create a draft encounter from a scheduled appointment',
    description:
      'Appointment access is required in addition to encounter creation. Only eligible scheduled appointments can be linked.',
  })
  @ApiBody({ type: CreateEncounterFromAppointmentRequestDto })
  @ApiCreatedResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: EncounterErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  createFromAppointment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createEncounterFromAppointmentSchema))
    body: CreateEncounterFromAppointmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['createFromAppointment']> {
    return this.encounters.createFromAppointment(
      context,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('encounters/direct')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.encounters.create', 'tenant.encounters.create.direct')
  @ApiOperation({
    summary: 'Create a draft encounter without an appointment',
    description:
      'Direct creation requires a separate permission and active, tenant-owned patient, provider, and location references.',
  })
  @ApiBody({ type: CreateDirectEncounterRequestDto })
  @ApiCreatedResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: EncounterErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  createDirect(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createDirectEncounterSchema)) body: CreateDirectEncounterInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['createDirect']> {
    return this.encounters.createDirect(context, body, actor, this.requestContext(request));
  }

  @Get('encounters/effective-time-zones')
  @RequireTenantPermissions('tenant.encounters.read')
  @ApiOperation({
    summary: 'Resolve active facility time zones for local-date encounter filters',
  })
  @ApiQuery({
    name: 'facilityIds',
    required: true,
    type: String,
    description: 'Comma-separated tenant facility UUIDs (maximum 20).',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              facilityId: { type: 'string', format: 'uuid' },
              timeZone: { type: 'string', nullable: true },
              status: { type: 'string', enum: ['ACTIVE_POLICY', 'NO_ACTIVE_POLICY'] },
            },
          },
        },
      },
    },
  })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  effectiveTimeZones(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(encounterEffectiveTimeZonesQuerySchema))
    query: EncounterEffectiveTimeZonesQuery,
  ): ReturnType<EncounterService['effectiveTimeZones']> {
    return this.encounters.effectiveTimeZones(context, query);
  }

  @Get('encounters')
  @RequireTenantPermissions('tenant.encounters.read')
  @ApiOperation({
    summary: 'List encounter summaries within the authenticated facility and branch scope',
    description:
      'List responses intentionally omit clinical content. Patient filtering additionally requires patient clinical-history permission.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    format: 'uuid',
    description: 'Exact encounter, appointment, patient, or doctor identifier',
  })
  @ApiQuery({ name: 'patientId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'doctorId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'branchId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'COMPLETED', 'CANCELLED'] })
  @ApiQuery({ name: 'from', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'fromDate', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'toDate', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 100_000 })
  @ApiOkResponse({ type: EncounterListResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: EncounterErrorResponseDto })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listEncountersQuerySchema)) query: ListEncountersQuery,
  ): ReturnType<EncounterService['list']> {
    return this.encounters.list(context, query);
  }

  @Get('patients/:patientId/encounters')
  @RequireTenantPermissions('tenant.encounters.patient-history.read')
  @ApiOperation({
    summary: 'Read a paginated patient encounter history, including documented clinical content',
  })
  @ApiParam({ name: 'patientId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: PatientEncounterHistoryResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: EncounterErrorResponseDto })
  patientHistory(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('patientId', new ZodValidationPipe(encounterIdSchema)) patientId: string,
    @Query(new ZodValidationPipe(listEncountersQuerySchema)) query: ListEncountersQuery,
  ): ReturnType<EncounterService['patientHistory']> {
    return this.encounters.patientHistory(context, patientId, query);
  }

  @Get('encounters/:encounterId')
  @RequireTenantPermissions('tenant.encounters.read')
  @ApiOperation({ summary: 'Read a tenant encounter and its clinical sections' })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
  ): ReturnType<EncounterService['findById']> {
    return this.encounters.findById(context, encounterId);
  }

  @Put('encounters/:encounterId/diagnoses')
  @RequireTenantPermissions(
    'tenant.encounters.read',
    'tenant.encounters.diagnoses.read',
    'tenant.encounters.services.read',
    'tenant.encounters.diagnoses.write',
  )
  @ApiOperation({
    summary: 'Replace structured diagnoses on an editable encounter',
    description:
      'A non-empty list must contain exactly one primary diagnosis. Descriptions are clinician-entered text; this API does not assign terminology codes.',
  })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: ReplaceEncounterDiagnosesRequestDto })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  replaceDiagnoses(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Body(new ZodValidationPipe(replaceEncounterDiagnosesSchema))
    body: ReplaceEncounterDiagnosesInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['replaceDiagnoses']> {
    return this.encounters.replaceDiagnoses(
      context,
      encounterId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Put('encounters/:encounterId/services')
  @RequireTenantPermissions(
    'tenant.encounters.read',
    'tenant.encounters.diagnoses.read',
    'tenant.encounters.services.read',
    'tenant.encounters.services.write',
  )
  @ApiOperation({
    summary: 'Replace clinical service and procedure records on an editable encounter',
    description:
      'References are resolved within the current tenant and encounter location. This endpoint does not create orders, charges, claims, or inventory movements.',
  })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: ReplaceEncounterServiceRecordsRequestDto })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: EncounterErrorResponseDto })
  replaceServiceRecords(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Body(new ZodValidationPipe(replaceEncounterServiceRecordsSchema))
    body: ReplaceEncounterServiceRecordsInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['replaceServiceRecords']> {
    return this.encounters.replaceServiceRecords(
      context,
      encounterId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('encounters/:encounterId/amendments')
  @RequireTenantPermissions(
    'tenant.encounters.read',
    'tenant.encounters.diagnoses.read',
    'tenant.encounters.services.read',
    'tenant.encounters.amendments.create',
  )
  @ApiOperation({
    summary: 'Open a reasoned amendment draft for a completed encounter',
    description:
      'The original completed record remains preserved. The amendment is not effective until explicitly finalized.',
  })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: CreateEncounterAmendmentRequestDto })
  @ApiCreatedResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  createAmendment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Body(new ZodValidationPipe(createEncounterAmendmentSchema))
    body: CreateEncounterAmendmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['createEncounterAmendment']> {
    return this.encounters.createEncounterAmendment(
      context,
      encounterId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Patch('encounters/:encounterId/amendments/:amendmentId')
  @RequireTenantPermissions(
    'tenant.encounters.read',
    'tenant.encounters.diagnoses.read',
    'tenant.encounters.services.read',
    'tenant.encounters.amendments.update',
  )
  @ApiOperation({ summary: 'Update an open encounter amendment draft' })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'amendmentId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: UpdateEncounterAmendmentRequestDto })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: EncounterErrorResponseDto })
  updateAmendment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Param('amendmentId', new ZodValidationPipe(encounterIdSchema)) amendmentId: string,
    @Body(new ZodValidationPipe(updateEncounterAmendmentSchema))
    body: UpdateEncounterAmendmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['updateEncounterAmendment']> {
    return this.encounters.updateEncounterAmendment(
      context,
      encounterId,
      amendmentId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('encounters/:encounterId/amendments/:amendmentId/finalize')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions(
    'tenant.encounters.read',
    'tenant.encounters.diagnoses.read',
    'tenant.encounters.services.read',
    'tenant.encounters.amendments.finalize',
  )
  @ApiOperation({ summary: 'Finalize an open encounter amendment' })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({ name: 'amendmentId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ schema: { type: 'object', required: ['expectedVersion'] } })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  finalizeAmendment(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Param('amendmentId', new ZodValidationPipe(encounterIdSchema)) amendmentId: string,
    @Body(new ZodValidationPipe(finalizeEncounterAmendmentSchema))
    body: FinalizeEncounterAmendmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['finalizeEncounterAmendment']> {
    return this.encounters.finalizeEncounterAmendment(
      context,
      encounterId,
      amendmentId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Patch('encounters/:encounterId/clinical')
  @RequireTenantPermissions('tenant.encounters.read', 'tenant.encounters.clinical.write')
  @ApiOperation({
    summary: 'Update selected clinical fields on an editable draft encounter',
    description:
      'Uses an expected version. Null clears a supplied field; omitted fields remain unchanged. Finalized encounters cannot be edited.',
  })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: UpdateEncounterRequestDto })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  updateClinical(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Body(new ZodValidationPipe(updateEncounterSchema)) body: UpdateEncounterInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['updateClinical']> {
    return this.encounters.updateClinical(
      context,
      encounterId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('encounters/:encounterId/complete')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.encounters.read', 'tenant.encounters.complete')
  @ApiOperation({
    summary: 'Complete an editable draft encounter',
    description:
      'Completion is final. Any later changes require a separately reasoned amendment draft and explicit finalization.',
  })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedVersion'],
      properties: { expectedVersion: { type: 'integer', minimum: 1 } },
    },
  })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  complete(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Body(new ZodValidationPipe(completeEncounterSchema)) body: CompleteEncounterInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['complete']> {
    return this.encounters.complete(
      context,
      encounterId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('encounters/:encounterId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.encounters.read', 'tenant.encounters.cancel')
  @ApiOperation({ summary: 'Cancel an editable draft encounter without deleting it' })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiBody({ type: CancelEncounterRequestDto })
  @ApiOkResponse({ type: EncounterResponseDto })
  @ApiBadRequestResponse({ type: EncounterErrorResponseDto })
  @ApiForbiddenResponse({ type: EncounterErrorResponseDto })
  @ApiConflictResponse({ type: EncounterErrorResponseDto })
  @ApiNotFoundResponse({ type: EncounterErrorResponseDto })
  cancel(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
    @Body(new ZodValidationPipe(cancelEncounterSchema)) body: CancelEncounterInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<EncounterService['cancel']> {
    return this.encounters.cancel(context, encounterId, body, actor, this.requestContext(request));
  }

  @Post('encounters/audit-reconciliation')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.encounters.audit.reconcile')
  @ApiOperation({
    summary: 'Reconcile pending encounter audit delivery for the authenticated tenant',
  })
  @ApiOkResponse({ description: 'Sanitized operation outcomes' })
  reconcileAudit(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body() body: { limit?: number },
  ): ReturnType<EncounterService['reconcileAudit']> {
    return this.encounters.reconcileAudit(context, body?.limit);
  }

  @Get('encounters/:encounterId/history')
  @RequireTenantPermissions('tenant.encounters.read', 'tenant.encounters.history.read')
  @ApiOperation({
    summary: 'Read encounter lifecycle and clinical-change metadata without clinical values',
  })
  @ApiParam({ name: 'encounterId', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              action: {
                type: 'string',
                enum: [
                  'CREATED',
                  'CLINICAL_UPDATED',
                  'DIAGNOSES_UPDATED',
                  'SERVICE_RECORDS_UPDATED',
                  'COMPLETED',
                  'CANCELLED',
                  'AMENDMENT_OPENED',
                  'AMENDMENT_UPDATED',
                  'AMENDMENT_FINALIZED',
                ],
              },
              actorUserId: { type: 'string', format: 'uuid' },
              occurredAt: { type: 'string', format: 'date-time' },
              fromVersion: { type: 'integer' },
              toVersion: { type: 'integer' },
              changedFields: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  })
  history(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('encounterId', new ZodValidationPipe(encounterIdSchema)) encounterId: string,
  ): ReturnType<EncounterService['history']> {
    return this.encounters.history(context, encounterId);
  }

  private requestContext(request: FastifyRequest): {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  } {
    const userAgent = request.headers['user-agent'];
    return {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
