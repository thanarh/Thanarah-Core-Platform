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
  changeFeatureStatusSchema,
  createFeatureSchema,
  featureIdSchema,
  listFeaturesQuerySchema,
  updateFeatureSchema,
  type ChangeFeatureStatusInput,
  type CreateFeatureInput,
  type ListFeaturesQuery,
  type UpdateFeatureInput,
} from './catalog.dto';
import { FeatureService } from './feature.service';

@ApiTags('Platform Features')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/platform/features`)
export class FeatureController {
  constructor(@Inject(FeatureService) private readonly features: FeatureService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('features.manage')
  @ApiOperation({ summary: 'Create a platform SaaS Feature definition' })
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
  @ApiCreatedResponse({ description: 'Feature created' })
  @ApiBadRequestResponse({ description: 'Feature input is invalid' })
  @ApiConflictResponse({ description: 'Feature key is already in use' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Feature management permission is required' })
  create(
    @Body(new ZodValidationPipe(createFeatureSchema)) body: CreateFeatureInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<FeatureService['create']> {
    return this.features.create(body, actor, catalogAuditContext(request));
  }

  @Get()
  @RequirePermissions('features.read')
  @ApiOperation({ summary: 'List platform SaaS Feature definitions' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'] })
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
  @ApiOkResponse({ description: 'Features returned' })
  @ApiBadRequestResponse({ description: 'Feature list filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Feature read permission is required' })
  list(
    @Query(new ZodValidationPipe(listFeaturesQuerySchema)) query: ListFeaturesQuery,
  ): ReturnType<FeatureService['list']> {
    return this.features.list(query);
  }

  @Get(':featureId')
  @RequirePermissions('features.read')
  @ApiOperation({ summary: 'Get a platform SaaS Feature definition' })
  @ApiParam({
    name: 'featureId',
    description: 'Feature UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Feature returned' })
  @ApiBadRequestResponse({ description: 'Feature identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Feature was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Feature read permission is required' })
  findById(
    @Param('featureId', new ZodValidationPipe(featureIdSchema)) featureId: string,
  ): ReturnType<FeatureService['findById']> {
    return this.features.findById(featureId);
  }

  @Patch(':featureId')
  @RequirePermissions('features.manage')
  @ApiOperation({ summary: 'Update Feature presentation metadata; its key is immutable' })
  @ApiParam({
    name: 'featureId',
    description: 'Feature UUID',
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
  @ApiOkResponse({ description: 'Feature updated' })
  @ApiBadRequestResponse({ description: 'Feature identifier or input is invalid' })
  @ApiNotFoundResponse({ description: 'Feature was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Feature management permission is required' })
  update(
    @Param('featureId', new ZodValidationPipe(featureIdSchema)) featureId: string,
    @Body(new ZodValidationPipe(updateFeatureSchema)) body: UpdateFeatureInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<FeatureService['update']> {
    return this.features.update(featureId, body, actor, catalogAuditContext(request));
  }

  @Patch(':featureId/status')
  @RequirePermissions('features.manage')
  @ApiOperation({ summary: 'Activate or deactivate a Feature definition' })
  @ApiParam({
    name: 'featureId',
    description: 'Feature UUID',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
    },
  })
  @ApiOkResponse({ description: 'Feature status changed' })
  @ApiBadRequestResponse({ description: 'Feature identifier or status is invalid' })
  @ApiNotFoundResponse({ description: 'Feature was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Feature management permission is required' })
  changeStatus(
    @Param('featureId', new ZodValidationPipe(featureIdSchema)) featureId: string,
    @Body(new ZodValidationPipe(changeFeatureStatusSchema)) body: ChangeFeatureStatusInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<FeatureService['changeStatus']> {
    return this.features.changeStatus(featureId, body.status, actor, catalogAuditContext(request));
  }
}
