import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { readReceiptMultipartForm } from '../common/receipt-upload';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { SubscriptionPaymentInputError } from '../subscriptions/subscription-payment.errors';
import { SubscriptionPaymentService } from '../subscriptions/subscription-payment.service';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';

@ApiTags('Tenant Subscription Portal')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/subscription-portal`)
export class TenantSubscriptionPortalController {
  constructor(private readonly payments: SubscriptionPaymentService) {}

  @Get()
  @RequireTenantPermissions('tenant.subscriptions.read')
  @ApiOperation({
    summary: 'Read the trusted tenant subscription and bank-transfer review status',
  })
  @ApiOkResponse({ description: 'Tenant subscription portal data returned' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant subscription read permission is required' })
  getPortal(@CurrentTenantContext() context: TrustedTenantContext) {
    return this.payments.getTenantPortal(context.tenantId);
  }

  @Post('transfers')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions(
    'tenant.subscriptions.read',
    'tenant.subscriptions.payments.submit',
  )
  @ApiOperation({
    summary: 'Submit a bank-transfer receipt for the current tenant subscription',
    description:
      'Uses the trusted tenant context; clients cannot select another tenant or subscription. No price is inferred and no charge is collected.',
  })
  @ApiCreatedResponse({ description: 'Receipt stored for platform review' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant subscription submission permission is required' })
  async submitTransfer(
    @CurrentTenantContext() context: TrustedTenantContext,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    if (Array.isArray(idempotencyKey)) throw new SubscriptionPaymentInputError();
    const { receipt, fields } = await readReceiptMultipartForm(request);
    if (Object.keys(fields).length) throw new SubscriptionPaymentInputError();
    return this.payments.submitTenantTransfer(
      context.tenantId,
      receipt,
      actor,
      idempotencyKey,
    );
  }
}
