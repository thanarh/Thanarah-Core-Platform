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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TenantStatus } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../auth/guards/platform-authorization.guard';
import {
  changeTenantStatusSchema,
  createTenantSchema,
  listTenantsQuerySchema,
  tenantIdSchema,
  type ChangeTenantStatusInput,
  type CreateTenantInput,
  type ListTenantsQuery,
} from './tenant.dto';
import { TenantService, type TenantRequestAuditContext } from './tenant.service';
import type { TenantRecord } from './tenant.repository';

@ApiTags('Platform Tenants')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/platform/tenants`)
export class TenantController {
  constructor(@Inject(TenantService) private readonly tenants: TenantService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('platform.manage')
  @ApiOperation({ summary: 'Create a central-platform tenant organization' })
  @ApiCreatedResponse({ description: 'Tenant organization created' })
  @ApiBadRequestResponse({ description: 'Tenant input is invalid' })
  @ApiConflictResponse({ description: 'Tenant slug is already in use' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform management permission is required' })
  create(
    @Body(new ZodValidationPipe(createTenantSchema)) body: CreateTenantInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantService['create']> {
    return this.tenants.create(body, actor, this.requestContext(request));
  }

  @Get()
  @RequirePermissions('platform.read')
  @ApiOperation({ summary: 'List central-platform tenant organizations' })
  @ApiOkResponse({ description: 'Tenant organizations returned' })
  @ApiBadRequestResponse({ description: 'List filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform read permission is required' })
  list(
    @Query(new ZodValidationPipe(listTenantsQuerySchema)) query: ListTenantsQuery,
  ): ReturnType<TenantService['list']> {
    return this.tenants.list(query);
  }

  @Get(':id')
  @RequirePermissions('platform.read')
  @ApiOperation({ summary: 'Get a central-platform tenant organization' })
  @ApiOkResponse({ description: 'Tenant organization returned' })
  @ApiBadRequestResponse({ description: 'Tenant identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Tenant organization was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform read permission is required' })
  findById(@Param('id', new ZodValidationPipe(tenantIdSchema)) id: string): Promise<TenantRecord> {
    return this.tenants.findById(id);
  }

  @Patch(':id/status')
  @RequirePermissions('platform.manage')
  @ApiOperation({ summary: 'Change a tenant organization lifecycle status' })
  @ApiOkResponse({ description: 'Tenant status changed' })
  @ApiBadRequestResponse({ description: 'Tenant identifier or status is invalid' })
  @ApiConflictResponse({ description: 'Lifecycle transition is not allowed' })
  @ApiNotFoundResponse({ description: 'Tenant organization was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform management permission is required' })
  changeStatus(
    @Param('id', new ZodValidationPipe(tenantIdSchema)) id: string,
    @Body(new ZodValidationPipe(changeTenantStatusSchema)) body: ChangeTenantStatusInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantService['changeStatus']> {
    return this.tenants.changeStatus(
      id,
      body.status as TenantStatus,
      actor,
      this.requestContext(request),
    );
  }

  private requestContext(request: FastifyRequest): TenantRequestAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
