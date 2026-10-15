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
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
} from './appointment.dto';
import type {
  CreateAppointmentInput,
  ListAppointmentsQuery,
  RescheduleAppointmentInput,
  UpdateAppointmentInput,
} from './appointment.dto';
import { AppointmentService } from './appointment.service';
import {
  AppointmentErrorResponseDto,
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
      'Validates tenant-owned references, active provider and location assignments, and overlaps already visible in storage. The read-before-write overlap check is not an atomic concurrent-booking guarantee.',
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
  ): ReturnType<AppointmentService['create']> {
    return this.appointments.create(context, body, actor, this.requestContext(request));
  }

  @Get('appointments')
  @RequireTenantPermissions('tenant.appointments.read')
  @ApiOperation({
    summary: 'List appointments in the trusted tenant and staff location scope',
    description:
      'The from/to range returns appointments that overlap the half-open interval [from, to).',
  })
  @ApiQuery({ name: 'from', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'doctorId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'facilityId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'branchId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'patientId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['SCHEDULED', 'CANCELLED'] })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({ type: AppointmentListResponseDto })
  @ApiBadRequestResponse({ type: AppointmentErrorResponseDto })
  @ApiForbiddenResponse({ type: AppointmentErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listAppointmentsQuerySchema)) query: ListAppointmentsQuery,
  ): ReturnType<AppointmentService['list']> {
    return this.appointments.list(context, query);
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
      'Validates the updated provider, facility, optional branch, and interval. Overlap checking excludes the appointment being rescheduled and is not an atomic concurrent-booking guarantee.',
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
