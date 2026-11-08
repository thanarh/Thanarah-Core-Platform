import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { TenantAuthorizationGuard } from '../tenant/tenant-authorization.guard';
import { TenantContextGuard } from '../tenant/tenant-context.guard';
import { CurrentTenantContext } from '../tenant/tenant-current-context.decorator';
import type { TrustedTenantContext } from '../tenant/tenant-context.contract';
import { RequireTenantPermissions } from '../tenant/tenant-require-permissions.decorator';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  communicationChannelSchema,
  communicationEventQuerySchema,
  communicationProviderSchema,
  communicationWebhookParamsSchema,
  consentSubjectRefSchema,
  saveCommunicationConsentSchema,
  saveCommunicationPolicySchema,
  simulateCommunicationSchema,
} from './communications.dto';
import type {
  SaveCommunicationConsentInput,
  SaveCommunicationPolicyInput,
  SimulateCommunicationInput,
} from './communications.dto';
import type {
  CommunicationConsent,
  CommunicationEvent,
  CommunicationEventView,
  CommunicationProviderStatus,
  CommunicationRetentionPolicy,
} from './communications.types';
import { CommunicationWebhookRejectedError } from './communications.errors';
import { CommunicationsService } from './communications.service';

@ApiTags('Tenant Communications')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/communications`)
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get('providers')
  @RequireTenantPermissions('tenant.communications.read')
  @ApiOperation({ summary: 'Show provider readiness without enabling live delivery' })
  @ApiOkResponse()
  listProviders(): readonly CommunicationProviderStatus[] {
    return this.communications.listProviders();
  }

  @Get('policy')
  @RequireTenantPermissions('tenant.communications.read')
  @ApiOkResponse()
  getPolicy(
    @CurrentTenantContext() context: TrustedTenantContext,
  ): Promise<CommunicationRetentionPolicy> {
    return this.communications.getPolicy(context);
  }

  @Put('policy')
  @RequireTenantPermissions('tenant.communications.manage')
  @ApiBody({ schema: { type: 'object', required: ['retentionDays', 'maxRetryAttempts'] } })
  @ApiOkResponse()
  savePolicy(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(saveCommunicationPolicySchema)) body: SaveCommunicationPolicyInput,
  ): Promise<CommunicationRetentionPolicy> {
    return this.communications.savePolicy(context, body, actor.userId);
  }

  @Get('consents/:subjectRef/:channel')
  @RequireTenantPermissions('tenant.communications.read')
  @ApiOkResponse()
  getConsent(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('subjectRef', new ZodValidationPipe(consentSubjectRefSchema)) subjectRef: string,
    @Param('channel', new ZodValidationPipe(communicationChannelSchema))
    channel: 'WHATSAPP' | 'VOICE',
  ): Promise<CommunicationConsent | null> {
    return this.communications.getConsent(context, subjectRef, channel);
  }

  @Put('consents')
  @RequireTenantPermissions('tenant.communications.consent.manage')
  @ApiBody({ schema: { type: 'object', required: ['subjectRef', 'channel', 'status', 'source'] } })
  @ApiOkResponse()
  saveConsent(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(saveCommunicationConsentSchema))
    body: SaveCommunicationConsentInput,
  ): Promise<CommunicationConsent> {
    return this.communications.saveConsent(context, body, actor.userId);
  }

  @Get('events')
  @RequireTenantPermissions('tenant.communications.read')
  @ApiOkResponse()
  listEvents(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(communicationEventQuerySchema))
    query: { limit: number },
  ): Promise<CommunicationEventView[]> {
    return this.communications.listEvents(context, query.limit);
  }

  @Post('simulate')
  @RequireTenantPermissions('tenant.communications.simulate')
  @ApiBody({ schema: { type: 'object', required: ['subjectRef', 'channel', 'template'] } })
  @ApiOkResponse()
  simulate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Body(new ZodValidationPipe(simulateCommunicationSchema)) body: SimulateCommunicationInput,
  ): Promise<{
    status: CommunicationEvent['status'];
    liveSent: false;
    recorded: boolean;
  }> {
    return this.communications.simulate(context, body, actor.userId);
  }
}

@Controller(`${APP_CONSTANTS.apiVersion}/communication-webhooks`)
export class CommunicationsWebhookController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get(':provider/:tenantId')
  @ApiOperation({ summary: 'Validate a provider subscription challenge when approved' })
  @ApiOkResponse({ type: String })
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async verifyChallenge(
    @Param('provider', new ZodValidationPipe(communicationProviderSchema))
    provider: 'whatsapp' | 'voice',
    @Param('tenantId', new ZodValidationPipe(communicationWebhookParamsSchema.shape.tenantId))
    tenantId: string,
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Res({ passthrough: true }) response: FastifyReply,
  ): Promise<string> {
    response.type('text/plain; charset=utf-8');
    return this.communications.verifyWebhookChallenge({
      provider,
      tenantIdCandidate: tenantId,
      query,
      headers: request.headers,
    });
  }

  @Post(':provider/:tenantId')
  @ApiOperation({ summary: 'Receive authenticated provider webhooks when an adapter is approved' })
  @ApiOkResponse()
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  receive(
    @Param('provider', new ZodValidationPipe(communicationProviderSchema))
    provider: 'whatsapp' | 'voice',
    @Param('tenantId', new ZodValidationPipe(communicationWebhookParamsSchema.shape.tenantId))
    tenantId: string,
    @Req() request: RawBodyRequest<FastifyRequest>,
  ): Promise<{ accepted: number; duplicates: number }> {
    if (!request.rawBody) throw new CommunicationWebhookRejectedError();
    return this.communications.ingestWebhook({
      provider,
      tenantIdCandidate: tenantId,
      rawBody: request.rawBody,
      headers: request.headers,
    });
  }
}
