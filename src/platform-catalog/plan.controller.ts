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
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../auth/guards/platform-authorization.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { catalogAuditContext } from './catalog-audit.context';
import {
  attachPlanFeatureSchema,
  changePlanStatusSchema,
  createPlanSchema,
  listPlansQuerySchema,
  planIdSchema,
  featureIdSchema,
  updatePlanFeatureSchema,
  updatePlanSchema,
  type ChangePlanStatusInput,
  type AttachPlanFeatureInput,
  type CreatePlanInput,
  type ListPlansQuery,
  type UpdatePlanFeatureInput,
  type UpdatePlanInput,
} from './catalog.dto';
import { PlanService } from './plan.service';

@ApiTags('Platform Plans')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/platform/plans`)
export class PlanController {
  constructor(@Inject(PlanService) private readonly plans: PlanService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('plans.manage')
  @ApiOperation({ summary: 'Create a platform SaaS Plan' })
  @ApiBody({
    description: 'The catalog key is normalized to uppercase and becomes immutable after creation.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'name'],
      properties: {
        key: { type: 'string', minLength: 1, maxLength: 64 },
        name: { type: 'string', minLength: 1, maxLength: 191 },
        description: { type: 'string', maxLength: 1000 },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Plan created' })
  @ApiBadRequestResponse({ description: 'Plan input is invalid' })
  @ApiConflictResponse({ description: 'Plan key is already in use' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan management permission is required' })
  create(
    @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PlanService['create']> {
    return this.plans.create(body, actor, catalogAuditContext(request));
  }

  @Get()
  @RequirePermissions('plans.read')
  @ApiOperation({ summary: 'List platform SaaS Plans' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
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
  @ApiOkResponse({ description: 'Plans returned' })
  @ApiBadRequestResponse({ description: 'Plan list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan read permission is required' })
  list(
    @Query(new ZodValidationPipe(listPlansQuerySchema)) query: ListPlansQuery,
  ): ReturnType<PlanService['list']> {
    return this.plans.list(query);
  }

  @Get(':planId')
  @RequirePermissions('plans.read')
  @ApiOperation({ summary: 'Get a platform SaaS Plan' })
  @ApiParam({
    name: 'planId',
    description: 'Plan UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Plan returned' })
  @ApiBadRequestResponse({ description: 'Plan identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Plan was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan read permission is required' })
  findById(
    @Param('planId', new ZodValidationPipe(planIdSchema)) planId: string,
  ): ReturnType<PlanService['findById']> {
    return this.plans.findById(planId);
  }

  @Patch(':planId')
  @RequirePermissions('plans.manage')
  @ApiOperation({ summary: 'Update Plan presentation metadata; its key is immutable' })
  @ApiParam({
    name: 'planId',
    description: 'Plan UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 191 },
        description: { type: 'string', maxLength: 1000, nullable: true },
      },
    },
  })
  @ApiOkResponse({ description: 'Plan updated' })
  @ApiBadRequestResponse({ description: 'Plan identifier or input is invalid' })
  @ApiConflictResponse({ description: 'Archived Plan metadata cannot be changed' })
  @ApiNotFoundResponse({ description: 'Plan was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan management permission is required' })
  update(
    @Param('planId', new ZodValidationPipe(planIdSchema)) planId: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PlanService['update']> {
    return this.plans.update(planId, body, actor, catalogAuditContext(request));
  }

  @Patch(':planId/status')
  @RequirePermissions('plans.manage')
  @ApiOperation({ summary: 'Change Plan lifecycle status' })
  @ApiParam({
    name: 'planId',
    description: 'Plan UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] } },
    },
  })
  @ApiOkResponse({ description: 'Plan status changed' })
  @ApiBadRequestResponse({ description: 'Plan identifier or status is invalid' })
  @ApiConflictResponse({ description: 'Plan lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Plan was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan management permission is required' })
  changeStatus(
    @Param('planId', new ZodValidationPipe(planIdSchema)) planId: string,
    @Body(new ZodValidationPipe(changePlanStatusSchema)) body: ChangePlanStatusInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PlanService['changeStatus']> {
    return this.plans.changeStatus(planId, body.status, actor, catalogAuditContext(request));
  }

  @Get(':planId/features')
  @RequirePermissions('plans.read')
  @ApiOperation({ summary: 'List Features attached to a Plan' })
  @ApiParam({
    name: 'planId',
    description: 'Plan UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Plan Features returned' })
  @ApiBadRequestResponse({ description: 'Plan identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Plan was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan read permission is required' })
  listFeatures(
    @Param('planId', new ZodValidationPipe(planIdSchema)) planId: string,
  ): ReturnType<PlanService['listFeatures']> {
    return this.plans.listFeatures(planId);
  }

  @Post(':planId/features')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('plan_features.manage')
  @ApiOperation({ summary: 'Attach an active Feature to an active Plan' })
  @ApiParam({
    name: 'planId',
    description: 'Plan UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['featureId'],
      properties: { featureId: { type: 'string', format: 'uuid' } },
    },
  })
  @ApiCreatedResponse({ description: 'Feature attached to Plan' })
  @ApiBadRequestResponse({ description: 'Plan or Feature identifier is invalid' })
  @ApiConflictResponse({ description: 'Association or lifecycle state prevents attachment' })
  @ApiNotFoundResponse({ description: 'Plan or Feature was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan Feature management permission is required' })
  attachFeature(
    @Param('planId', new ZodValidationPipe(planIdSchema)) planId: string,
    @Body(new ZodValidationPipe(attachPlanFeatureSchema)) body: AttachPlanFeatureInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PlanService['attachFeature']> {
    return this.plans.attachFeature(planId, body.featureId, actor, catalogAuditContext(request));
  }

  @Patch(':planId/features/:featureId')
  @RequirePermissions('plan_features.manage')
  @ApiOperation({ summary: 'Enable or disable a Feature on a Plan' })
  @ApiParam({
    name: 'planId',
    description: 'Plan UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'featureId',
    description: 'Feature UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled'],
      properties: { enabled: { type: 'boolean' } },
    },
  })
  @ApiOkResponse({ description: 'Plan Feature updated' })
  @ApiBadRequestResponse({ description: 'Plan Feature input or identifier is invalid' })
  @ApiConflictResponse({ description: 'Plan or Feature lifecycle prevents this change' })
  @ApiNotFoundResponse({ description: 'Plan Feature association was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan Feature management permission is required' })
  updateFeature(
    @Param('planId', new ZodValidationPipe(planIdSchema)) planId: string,
    @Param('featureId', new ZodValidationPipe(featureIdSchema)) featureId: string,
    @Body(new ZodValidationPipe(updatePlanFeatureSchema)) body: UpdatePlanFeatureInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PlanService['updateFeature']> {
    return this.plans.updateFeature(planId, featureId, body, actor, catalogAuditContext(request));
  }

  @Delete(':planId/features/:featureId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('plan_features.manage')
  @ApiOperation({ summary: 'Remove a Feature association from a Plan, not the catalog records' })
  @ApiParam({
    name: 'planId',
    description: 'Plan UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'featureId',
    description: 'Feature UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Plan Feature association removed' })
  @ApiBadRequestResponse({ description: 'Plan or Feature identifier is invalid' })
  @ApiConflictResponse({ description: 'Plan lifecycle prevents changing its associations' })
  @ApiNotFoundResponse({ description: 'Plan Feature association was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Plan Feature management permission is required' })
  detachFeature(
    @Param('planId', new ZodValidationPipe(planIdSchema)) planId: string,
    @Param('featureId', new ZodValidationPipe(featureIdSchema)) featureId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<PlanService['detachFeature']> {
    return this.plans.detachFeature(planId, featureId, actor, catalogAuditContext(request));
  }
}
