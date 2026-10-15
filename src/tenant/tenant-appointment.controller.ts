import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
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
  ApiHeader,
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
  appointmentIdSchema,
  appointmentEffectiveTimeZonesQuerySchema,
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
} from './appointment.dto';
import type {
  CreateAppointmentInput,
  AppointmentEffectiveTimeZonesQuery,
  ListAppointmentsQuery,
  RescheduleAppointmentInput,
  UpdateAppointmentInput,
} from './appointment.dto';
import { AppointmentService } from './appointment.service';
import { AppointmentInputValidationError } from './appointment.errors';
import {
  AppointmentErrorResponseDto,
  AppointmentEffectiveTimeZonesResponseDto,
  AppointmentListResponseDto,
  AppointmentResponseDto,
  CreateAppointmentRequestDto,
  RescheduleAppointmentRequestDto,
  UpdateAppointmentRequestDto,
} from './appointment.openapi';

@ApiTags('Tenant Appointments')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId`)
export class TenantAppointmentController {
  constructor(@Inject(AppointmentService) private readonly appointments: AppointmentService) {}

  @Post('appointments')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.appointments.create')
  @ApiOperation({
    summary: 'Create a scheduled appointment',
    description:
      'Validates tenant-owned references, active provider and location assignments, and serializes booking changes for the provider and facility. Send Idempotency-Key to make retries safe.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Optional opaque key (1–128 visible ASCII characters) for safe create retries.',
  })
  @ApiBody({ type: CreateAppointmentRequestDto })
  @ApiCreatedResponse({ type: AppointmentResponseDto })
  @ApiBadRequestResponse({ type: AppointmentErrorResponseDto })
  @ApiForbiddenResponse({ type: AppointmentErrorResponseDto })
  @ApiConflictResponse({ type: AppointmentErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: AppointmentErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  create(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createAppointmentSchema)) body: CreateAppointmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ): ReturnType<AppointmentService['create']> {
    if (Array.isArray(idempotencyKey)) throw new AppointmentInputValidationError();
    return this.appointments.create(
      context,
      body,
      actor,
      this.requestContext(request),
      idempotencyKey,
    );
  }

  @Get('appointments')
  @RequireTenantPermissions('tenant.appointments.read')
  @ApiOperation({
    summary: 'List appointments in the trusted tenant and staff location scope',
    description:
      'Search and filters apply across all accessible tenant results before pagination. Non-UUID patient search and patientId filtering require tenant.patients.read; appointment results never include patient demographics. Date-only filters use the active timezone policy for the required facility and include the whole local calendar day.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'fromDate', required: false, type: String, format: 'date' })
  @ApiQuery({ name: 'toDate', required: false, type: String, format: 'date' })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    maxLength: 128,
    description:
      'UUIDs search appointment/reference IDs; text searches patient-directory fields and requires tenant.patients.read.',
  })
  @ApiQuery({ name: 'doctorId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'branchId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'patientId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'serviceId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['SCHEDULED', 'CANCELLED'] })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 100_000 })
  @ApiOkResponse({ type: AppointmentListResponseDto })
  @ApiBadRequestResponse({ type: AppointmentErrorResponseDto })
  @ApiForbiddenResponse({ type: AppointmentErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: AppointmentErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listAppointmentsQuerySchema)) query: ListAppointmentsQuery,
  ): ReturnType<AppointmentService['list']> {
    return this.appointments.list(context, query);
  }

  @Get('appointments/effective-time-zones')
  @RequireTenantPermissions('tenant.appointments.read')
  @ApiOperation({
    summary: 'Read effective facility time zones for appointment display and date filtering',
    description:
      'Returns only each requested facility ID and its active policy timezone; policy rules and revisions are not exposed.',
  })
  @ApiQuery({
    name: 'facilityIds',
    required: true,
    type: String,
    description: 'Comma-separated facility UUIDs; maximum 20.',
  })
  @ApiOkResponse({ type: AppointmentEffectiveTimeZonesResponseDto })
  @ApiBadRequestResponse({ type: AppointmentErrorResponseDto })
  @ApiForbiddenResponse({ type: AppointmentErrorResponseDto })
  @ApiNotFoundResponse({ type: AppointmentErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  effectiveTimeZones(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(appointmentEffectiveTimeZonesQuerySchema))
    query: AppointmentEffectiveTimeZonesQuery,
  ): ReturnType<AppointmentService['effectiveTimeZones']> {
    return this.appointments.effectiveTimeZones(context, query.facilityIds);
  }

  @Get('appointments/:appointmentId')
  @RequireTenantPermissions('tenant.appointments.read')
  @ApiOperation({ summary: 'Retrieve an appointment without exposing patient demographics' })
  @ApiParam({ name: 'appointmentId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiBadRequestResponse({ type: AppointmentErrorResponseDto })
  @ApiNotFoundResponse({ type: AppointmentErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('appointmentId', new ZodValidationPipe(appointmentIdSchema)) appointmentId: string,
  ): ReturnType<AppointmentService['findById']> {
    return this.appointments.findById(context, appointmentId);
  }

  @Patch('appointments/:appointmentId')
  @RequireTenantPermissions('tenant.appointments.update')
  @ApiOperation({ summary: 'Update non-scheduling appointment fields' })
  @ApiParam({ name: 'appointmentId', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateAppointmentRequestDto })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiBadRequestResponse({ type: AppointmentErrorResponseDto })
  @ApiNotFoundResponse({ type: AppointmentErrorResponseDto })
  @ApiConflictResponse({ type: AppointmentErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: AppointmentErrorResponseDto })
  update(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('appointmentId', new ZodValidationPipe(appointmentIdSchema)) appointmentId: string,
    @Body(new ZodValidationPipe(updateAppointmentSchema)) body: UpdateAppointmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<AppointmentService['update']> {
    return this.appointments.update(
      context,
      appointmentId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('appointments/:appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.appointments.reschedule')
  @ApiOperation({
    summary: 'Reschedule or relocate an appointment',
    description:
      'Validates the updated provider, facility, optional branch, and interval while holding the relevant provider and facility scheduling locks.',
  })
  @ApiParam({ name: 'appointmentId', type: String, format: 'uuid' })
  @ApiBody({ type: RescheduleAppointmentRequestDto })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiBadRequestResponse({ type: AppointmentErrorResponseDto })
  @ApiNotFoundResponse({ type: AppointmentErrorResponseDto })
  @ApiConflictResponse({ type: AppointmentErrorResponseDto })
  @ApiForbiddenResponse({ type: AppointmentErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: AppointmentErrorResponseDto })
  reschedule(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('appointmentId', new ZodValidationPipe(appointmentIdSchema)) appointmentId: string,
    @Body(new ZodValidationPipe(rescheduleAppointmentSchema))
    body: RescheduleAppointmentInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<AppointmentService['reschedule']> {
    return this.appointments.reschedule(
      context,
      appointmentId,
      body,
      actor,
      this.requestContext(request),
    );
  }

  @Post('appointments/:appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.appointments.cancel')
  @ApiOperation({ summary: 'Cancel a scheduled appointment; cancellation cannot be reversed' })
  @ApiParam({ name: 'appointmentId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiNotFoundResponse({ type: AppointmentErrorResponseDto })
  @ApiConflictResponse({ type: AppointmentErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  cancel(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('appointmentId', new ZodValidationPipe(appointmentIdSchema)) appointmentId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<AppointmentService['cancel']> {
    return this.appointments.cancel(context, appointmentId, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  } {
    const requestId = request.id;
    const ipAddress = request.ip;
    const userAgent = request.headers['user-agent'];
    return {
      ...(typeof requestId === 'string' && requestId.length > 0 ? { requestId } : {}),
      ...(typeof ipAddress === 'string' && ipAddress.length > 0 ? { ipAddress } : {}),
      ...(typeof userAgent === 'string' && userAgent.length > 0 ? { userAgent } : {}),
    };
  }
}
