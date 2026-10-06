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
import { StaffStatus } from '@prisma/client';
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
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import {
  createTenantStaffSchema,
  listTenantStaffQuerySchema,
  tenantStaffIdSchema,
  updateTenantStaffSchema,
  type CreateTenantStaffInput,
  type ListTenantStaffQuery,
  type UpdateTenantStaffInput,
} from './tenant-staff.dto';
import { TenantStaffService, type TenantStaffAuditContext } from './tenant-staff.service';
import { TenantStaffListResponseDto, TenantStaffResponseDto } from './tenant-staff.openapi';

@ApiTags('Tenant Staff')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/staff`)
export class TenantStaffController {
  constructor(@Inject(TenantStaffService) private readonly staff: TenantStaffService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.staff.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({
    summary: 'Create a staff profile for an active tenant member',
    description:
      'The platform user is derived from the active membership. No new authentication identity is created.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['membershipId'],
      properties: {
        membershipId: { type: 'string', format: 'uuid' },
        displayName: { type: 'string', minLength: 1, maxLength: 191 },
        jobTitle: { type: 'string', minLength: 1, maxLength: 191 },
      },
    },
  })
  @ApiCreatedResponse({ type: TenantStaffResponseDto, description: 'Staff profile created' })
  @ApiBadRequestResponse({
    description: 'Membership identifier or staff profile details are invalid',
  })
  @ApiConflictResponse({
    description: 'Tenant is inactive or the tenant member already has a staff profile',
  })
  @ApiNotFoundResponse({
    description: 'An active tenant membership with an active platform user was not found',
  })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and staff manage permission are required',
  })
  create(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createTenantStaffSchema)) body: CreateTenantStaffInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffService['create']> {
    return this.staff.create(context, body, actor, this.requestContext(request));
  }

  @Get()
  @RequireTenantPermissions('tenant.staff.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiOperation({ summary: 'List staff profiles in the trusted tenant' })
  @ApiQuery({ name: 'status', required: false, enum: StaffStatus })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiOkResponse({
    type: TenantStaffListResponseDto,
    description: 'Tenant staff profiles returned',
  })
  @ApiBadRequestResponse({ description: 'Staff list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and staff read permission are required',
  })
  list(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listTenantStaffQuerySchema)) query: ListTenantStaffQuery,
  ): ReturnType<TenantStaffService['list']> {
    return this.staff.list(context, query);
  }

  @Get(':staffId')
  @RequireTenantPermissions('tenant.staff.read')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'staffId', description: 'Staff profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Get a staff profile from the trusted tenant' })
  @ApiOkResponse({ type: TenantStaffResponseDto, description: 'Staff profile returned' })
  @ApiBadRequestResponse({ description: 'Staff identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and staff read permission are required',
  })
  findById(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
  ): ReturnType<TenantStaffService['findById']> {
    return this.staff.findById(context, staffId);
  }

  @Patch(':staffId')
  @RequireTenantPermissions('tenant.staff.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'staffId', description: 'Staff profile identifier', format: 'uuid' })
  @ApiOperation({
    summary: 'Update descriptive staff profile fields',
    description:
      'Only displayName and jobTitle may be changed; identity, membership, and status are immutable here.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        displayName: { type: 'string', minLength: 1, maxLength: 191 },
        jobTitle: { type: 'string', nullable: true, minLength: 1, maxLength: 191 },
      },
    },
  })
  @ApiOkResponse({ type: TenantStaffResponseDto, description: 'Staff profile updated' })
  @ApiBadRequestResponse({ description: 'Staff identifier or profile changes are invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and staff manage permission are required',
  })
  update(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @Body(new ZodValidationPipe(updateTenantStaffSchema)) body: UpdateTenantStaffInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffService['update']> {
    return this.staff.update(context, staffId, body, actor, this.requestContext(request));
  }

  @Post(':staffId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.staff.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'staffId', description: 'Staff profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Suspend an active staff profile' })
  @ApiOkResponse({ type: TenantStaffResponseDto, description: 'Staff profile suspended' })
  @ApiBadRequestResponse({ description: 'Staff identifier is invalid' })
  @ApiConflictResponse({ description: 'The requested staff lifecycle transition is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and staff manage permission are required',
  })
  suspend(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffService['suspend']> {
    return this.staff.suspend(context, staffId, actor, this.requestContext(request));
  }

  @Post(':staffId/activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.staff.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'staffId', description: 'Staff profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Activate a suspended staff profile' })
  @ApiOkResponse({ type: TenantStaffResponseDto, description: 'Staff profile activated' })
  @ApiBadRequestResponse({ description: 'Staff identifier is invalid' })
  @ApiConflictResponse({ description: 'Deactivated staff cannot be reactivated' })
  @ApiNotFoundResponse({ description: 'Staff profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and staff manage permission are required',
  })
  activate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffService['activate']> {
    return this.staff.activate(context, staffId, actor, this.requestContext(request));
  }

  @Post(':staffId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.staff.manage')
  @ApiParam({ name: 'tenantId', description: 'Tenant selector validated as trusted context' })
  @ApiParam({ name: 'staffId', description: 'Staff profile identifier', format: 'uuid' })
  @ApiOperation({ summary: 'Permanently deactivate an active or suspended staff profile' })
  @ApiOkResponse({ type: TenantStaffResponseDto, description: 'Staff profile deactivated' })
  @ApiBadRequestResponse({ description: 'Staff identifier is invalid' })
  @ApiConflictResponse({ description: 'The requested staff lifecycle transition is invalid' })
  @ApiNotFoundResponse({ description: 'Staff profile was not found in this tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({
    description: 'An active tenant membership and staff manage permission are required',
  })
  deactivate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('staffId', new ZodValidationPipe(tenantStaffIdSchema)) staffId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantStaffService['deactivate']> {
    return this.staff.deactivate(context, staffId, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): TenantStaffAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
