import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
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
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../auth/guards/platform-authorization.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  currentSubscriptionQuerySchema,
  createSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionIdSchema,
  type CreateSubscriptionInput,
  type ListSubscriptionsQuery,
} from './subscription.dto';
import { subscriptionAuditContext } from './subscription-audit.context';
import {
  subscriptionErrorResponseSchema,
  subscriptionListResponseSchema,
  subscriptionResponseSchema,
} from './subscription.openapi';
import { SubscriptionService } from './subscription.service';

@ApiTags('Platform Subscriptions')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/platform/subscriptions`)
export class SubscriptionController {
  constructor(@Inject(SubscriptionService) private readonly subscriptions: SubscriptionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('subscriptions.manage')
  @ApiOperation({
    summary: 'Assign an active Plan to a Tenant',
    description:
      'Requires platform permission subscriptions.manage. Status is derived by the service and cannot be supplied by the client.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['tenantId', 'planId', 'startsAt'],
      properties: {
        tenantId: { type: 'string', format: 'uuid' },
        planId: { type: 'string', format: 'uuid' },
        startsAt: { type: 'string', format: 'date-time', description: 'UTC timestamp ending in Z' },
        endsAt: {
          type: 'string',
          format: 'date-time',
          description: 'UTC timestamp ending in Z; omitted means open-ended',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Subscription created; effectiveStatus reflects its date window',
    schema: subscriptionResponseSchema,
  })
  @ApiBadRequestResponse({
    description: 'Identifiers or UTC subscription dates are invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription management permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'Tenant or Plan was not found',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiConflictResponse({
    description: 'Tenant or Plan is unavailable, or the period overlaps an active period',
    schema: subscriptionErrorResponseSchema,
  })
  create(
    @Body(new ZodValidationPipe(createSubscriptionSchema)) body: CreateSubscriptionInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<SubscriptionService['create']> {
    return this.subscriptions.create(body, actor, subscriptionAuditContext(request));
  }

  @Get()
  @RequirePermissions('subscriptions.read')
  @ApiOperation({
    summary: 'List platform Subscriptions',
    description: 'Requires platform permission subscriptions.read.',
  })
  @ApiQuery({ name: 'tenantId', required: false, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    schema: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
  })
  @ApiOkResponse({ description: 'Subscriptions returned', schema: subscriptionListResponseSchema })
  @ApiBadRequestResponse({
    description: 'Subscription list filters are invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription read permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  list(
    @Query(new ZodValidationPipe(listSubscriptionsQuerySchema)) query: ListSubscriptionsQuery,
  ): ReturnType<SubscriptionService['list']> {
    return this.subscriptions.list(query);
  }

  @Get('current')
  @RequirePermissions('subscriptions.read')
  @ApiOperation({
    summary: 'Resolve the current effective Subscription for a Tenant',
    description:
      'Requires platform permission subscriptions.read. Returns null if no ACTIVE Subscription covers the current UTC instant.',
  })
  @ApiQuery({ name: 'tenantId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    description: 'Current effective Subscription, or null if the Tenant has none',
    schema: { ...subscriptionResponseSchema, nullable: true },
  })
  @ApiBadRequestResponse({
    description: 'Tenant identifier is invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription read permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiInternalServerErrorResponse({
    description: 'More than one current Subscription violates the invariant',
    schema: subscriptionErrorResponseSchema,
  })
  findCurrent(
    @Query(new ZodValidationPipe(currentSubscriptionQuerySchema)) query: { tenantId: string },
  ): ReturnType<SubscriptionService['findCurrentForTenant']> {
    return this.subscriptions.findCurrentForTenant(query.tenantId);
  }

  @Get(':subscriptionId')
  @RequirePermissions('subscriptions.read')
  @ApiOperation({
    summary: 'Get a platform Subscription by ID',
    description: 'Requires platform permission subscriptions.read.',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Subscription UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Subscription returned', schema: subscriptionResponseSchema })
  @ApiBadRequestResponse({
    description: 'Subscription identifier is invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription read permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'Subscription was not found',
    schema: subscriptionErrorResponseSchema,
  })
  findById(
    @Param('subscriptionId', new ZodValidationPipe(subscriptionIdSchema)) subscriptionId: string,
  ): ReturnType<SubscriptionService['findById']> {
    return this.subscriptions.findById(subscriptionId);
  }

  @Post(':subscriptionId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('subscriptions.manage')
  @ApiOperation({
    summary: 'Reactivate a suspended Subscription',
    description:
      'Requires platform permission subscriptions.manage. Activation is rejected when the Tenant is unavailable or another active period overlaps.',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Subscription UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Subscription activated', schema: subscriptionResponseSchema })
  @ApiBadRequestResponse({
    description: 'Subscription identifier is invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription management permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'Subscription was not found',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiConflictResponse({
    description: 'Subscription transition, Tenant status, or active period prevents activation',
    schema: subscriptionErrorResponseSchema,
  })
  activate(
    @Param('subscriptionId', new ZodValidationPipe(subscriptionIdSchema)) subscriptionId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<SubscriptionService['activate']> {
    return this.subscriptions.activate(subscriptionId, actor, subscriptionAuditContext(request));
  }

  @Post(':subscriptionId/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('subscriptions.manage')
  @ApiOperation({
    summary: 'Suspend an active Subscription',
    description: 'Requires platform permission subscriptions.manage.',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Subscription UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Subscription suspended', schema: subscriptionResponseSchema })
  @ApiBadRequestResponse({
    description: 'Subscription identifier is invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription management permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'Subscription was not found',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiConflictResponse({
    description: 'Subscription cannot be suspended from its current lifecycle state',
    schema: subscriptionErrorResponseSchema,
  })
  suspend(
    @Param('subscriptionId', new ZodValidationPipe(subscriptionIdSchema)) subscriptionId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<SubscriptionService['suspend']> {
    return this.subscriptions.suspend(subscriptionId, actor, subscriptionAuditContext(request));
  }

  @Post(':subscriptionId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('subscriptions.manage')
  @ApiOperation({
    summary: 'Cancel an active or suspended Subscription',
    description:
      'Requires platform permission subscriptions.manage. Cancellation is explicit, preserves history, and sets cancelledAt in UTC.',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Subscription UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Subscription cancelled', schema: subscriptionResponseSchema })
  @ApiBadRequestResponse({
    description: 'Subscription identifier is invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription management permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'Subscription was not found',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiConflictResponse({
    description: 'Subscription cannot be cancelled from its current lifecycle state',
    schema: subscriptionErrorResponseSchema,
  })
  cancel(
    @Param('subscriptionId', new ZodValidationPipe(subscriptionIdSchema)) subscriptionId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<SubscriptionService['cancel']> {
    return this.subscriptions.cancel(subscriptionId, actor, subscriptionAuditContext(request));
  }

  @Post(':subscriptionId/expire')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('subscriptions.manage')
  @ApiOperation({
    summary: 'Mark an ended Subscription as expired',
    description:
      'Requires platform permission subscriptions.manage. This is explicit and does not run automatically in the background.',
  })
  @ApiParam({
    name: 'subscriptionId',
    description: 'Subscription UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Subscription expired', schema: subscriptionResponseSchema })
  @ApiBadRequestResponse({
    description: 'Subscription identifier is invalid',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiUnauthorizedResponse({
    description: 'Platform authentication is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiForbiddenResponse({
    description: 'Subscription management permission is required',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiNotFoundResponse({
    description: 'Subscription was not found',
    schema: subscriptionErrorResponseSchema,
  })
  @ApiConflictResponse({
    description: 'Subscription period has not ended or its lifecycle state prevents expiration',
    schema: subscriptionErrorResponseSchema,
  })
  expire(
    @Param('subscriptionId', new ZodValidationPipe(subscriptionIdSchema)) subscriptionId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<SubscriptionService['expire']> {
    return this.subscriptions.expire(subscriptionId, actor, subscriptionAuditContext(request));
  }
}
