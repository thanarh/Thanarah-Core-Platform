import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import {
  facilitySchedulingPolicyIdSchema,
  schedulingPolicyInputSchema,
  schedulingPolicyTransitionSchema,
} from './appointment-scheduling-policy.dto';
import type { SchedulingPolicyInput } from './appointment-scheduling-policy.dto';
import { FacilitySchedulingPolicyService } from './appointment-scheduling-policy.service';
import {
  SchedulingPolicyInputDto,
  SchedulingPolicyResponseDto,
  SchedulingPolicyRevisionListDto,
  SchedulingPolicyTransitionDto,
} from './scheduling-policy.openapi';

@ApiTags('Facility Scheduling Policies')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(
  `${APP_CONSTANTS.apiVersion}/tenants/:tenantId/facilities/:facilityId/scheduling-policy`,
)
export class FacilitySchedulingPolicyController {
  constructor(
    @Inject(FacilitySchedulingPolicyService)
    private readonly policies: FacilitySchedulingPolicyService,
  ) {}

  @Get()
  @RequireTenantPermissions('tenant.appointments.policy.manage')
  @ApiOperation({
    summary: 'Get a facility scheduling policy',
    description: 'Returns 404 when no policy has been configured for this facility.',
  })
  @ApiParam({ name: 'facilityId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: SchedulingPolicyResponseDto })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  get(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilitySchedulingPolicyIdSchema))
    facilityId: string,
  ): ReturnType<FacilitySchedulingPolicyService['get']> {
    return this.policies.get(context, facilityId);
  }

  @Put()
  @RequireTenantPermissions('tenant.appointments.policy.manage')
  @ApiOperation({
    summary: 'Create or update an inactive or active facility scheduling policy',
    description:
      'Policy rules are explicit and have no business-value defaults. Existing policies require expectedVersion. Saving does not activate a newly created policy.',
  })
  @ApiParam({ name: 'facilityId', type: String, format: 'uuid' })
  @ApiBody({ type: SchedulingPolicyInputDto })
  @ApiOkResponse({ type: SchedulingPolicyResponseDto })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse()
  @ApiUnauthorizedResponse()
  put(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilitySchedulingPolicyIdSchema))
    facilityId: string,
    @Body(new ZodValidationPipe(schedulingPolicyInputSchema)) body: SchedulingPolicyInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<FacilitySchedulingPolicyService['put']> {
    return this.policies.put(context, facilityId, body, actor, this.requestContext(request));
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.appointments.policy.manage')
  @ApiOperation({ summary: 'Activate a validated facility scheduling policy' })
  @ApiParam({ name: 'facilityId', type: String, format: 'uuid' })
  @ApiBody({ type: SchedulingPolicyTransitionDto })
  @ApiOkResponse({ type: SchedulingPolicyResponseDto })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse()
  @ApiUnauthorizedResponse()
  activate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilitySchedulingPolicyIdSchema))
    facilityId: string,
    @Body(new ZodValidationPipe(schedulingPolicyTransitionSchema))
    body: { expectedVersion: number },
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<FacilitySchedulingPolicyService['activate']> {
    return this.policies.activate(context, facilityId, body, actor, this.requestContext(request));
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.appointments.policy.manage')
  @ApiOperation({ summary: 'Deactivate a facility scheduling policy' })
  @ApiParam({ name: 'facilityId', type: String, format: 'uuid' })
  @ApiBody({ type: SchedulingPolicyTransitionDto })
  @ApiOkResponse({ type: SchedulingPolicyResponseDto })
  @ApiBadRequestResponse()
  @ApiConflictResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  deactivate(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilitySchedulingPolicyIdSchema))
    facilityId: string,
    @Body(new ZodValidationPipe(schedulingPolicyTransitionSchema))
    body: { expectedVersion: number },
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<FacilitySchedulingPolicyService['deactivate']> {
    return this.policies.deactivate(context, facilityId, body, actor, this.requestContext(request));
  }

  @Get('history')
  @RequireTenantPermissions('tenant.appointments.policy.manage')
  @ApiOperation({ summary: 'List revisions of a facility scheduling policy' })
  @ApiParam({ name: 'facilityId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: SchedulingPolicyRevisionListDto })
  @ApiBadRequestResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  history(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('facilityId', new ZodValidationPipe(facilitySchedulingPolicyIdSchema))
    facilityId: string,
    @Query() query: { limit?: number | string; offset?: number | string },
  ): ReturnType<FacilitySchedulingPolicyService['history']> {
    return this.policies.history(context, facilityId, query);
  }

  private requestContext(request: FastifyRequest): {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  } {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      ...(typeof requestId === 'string' && requestId.length > 0 ? { requestId } : {}),
      ...(typeof request.ip === 'string' && request.ip.length > 0 ? { ipAddress: request.ip } : {}),
      ...(typeof userAgent === 'string' && userAgent.length > 0 ? { userAgent } : {}),
    };
  }
}
