import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { PlatformAuthorizationGuard } from '../auth/guards/platform-authorization.guard';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { tenantIdSchema } from './tenant.dto';
import { bootstrapTenantOwnerSchema, type BootstrapTenantOwnerInput } from './tenant-role.dto';
import { TenantRoleService, type TenantRoleAuditContext } from './tenant-role.service';

@ApiTags('Tenant Role Bootstrap')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/platform/tenants/:tenantId/roles`)
export class TenantRoleBootstrapController {
  constructor(@Inject(TenantRoleService) private readonly roles: TenantRoleService) {}

  @Post('bootstrap')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('platform.manage')
  @ApiOperation({
    summary: 'Create the default tenant roles and assign the initial owner',
  })
  @ApiOkResponse({ description: 'Default tenant roles and initial owner assignment created' })
  @ApiBadRequestResponse({ description: 'Tenant or owner input is invalid' })
  @ApiConflictResponse({
    description: 'The tenant is inactive, already owned, or has no active owner membership',
  })
  @ApiNotFoundResponse({ description: 'Tenant or active membership was not found' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Platform management permission is required' })
  bootstrap(
    @Param('tenantId', new ZodValidationPipe(tenantIdSchema)) tenantId: string,
    @Body(new ZodValidationPipe(bootstrapTenantOwnerSchema)) body: BootstrapTenantOwnerInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
  ): ReturnType<TenantRoleService['bootstrapInitialOwner']> {
    return this.roles.bootstrapInitialOwner(tenantId, body, actor, this.requestContext(request));
  }

  private requestContext(request: FastifyRequest): TenantRoleAuditContext {
    const requestId = request.headers[APP_CONSTANTS.headers.requestId];
    const userAgent = request.headers['user-agent'];
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      ipAddress: request.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };
  }
}
