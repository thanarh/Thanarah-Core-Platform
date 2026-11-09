import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
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
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { readReceiptMultipartForm } from '../common/receipt-upload';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenantContext } from './tenant-current-context.decorator';
import type { TrustedTenantContext } from './tenant-context.contract';
import { TenantAuthorizationGuard } from './tenant-authorization.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { RequireTenantPermissions } from './tenant-require-permissions.decorator';
import {
  clinicInvoiceIdSchema,
  createClinicInvoiceSchema,
  listClinicInvoicesQuerySchema,
  returnClinicInvoiceToDraftSchema,
  updateClinicFinanceSettingsSchema,
  updateClinicInvoiceSchema,
  clinicInvoiceTransitionSchema,
  clinicInvoiceTransferIdSchema,
  clinicInvoiceTransferStatusSchema,
  reviewClinicInvoiceTransferSchema,
} from './clinic-finance.dto';
import type {
  CreateClinicInvoiceInput,
  ListClinicInvoicesQuery,
  UpdateClinicFinanceSettingsInput,
  UpdateClinicInvoiceInput,
} from './clinic-finance.dto';
import { ClinicFinanceService } from './clinic-finance.service';
import { ClinicFinanceInputError } from './clinic-finance.errors';

@ApiTags('Tenant Clinic Finance')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard, TenantContextGuard, TenantAuthorizationGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/tenants/:tenantId/finance`)
export class TenantClinicFinanceController {
  constructor(private readonly finance: ClinicFinanceService) {}

  @Get('settings')
  @RequireTenantPermissions('tenant.finance.read')
  @ApiOperation({ summary: 'Read clinic invoice settings for the trusted tenant' })
  @ApiOkResponse({ description: 'Current settings and revision history returned' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant finance read permission is required' })
  getSettings(@CurrentTenantContext() context: TrustedTenantContext) {
    return this.finance.getSettings(context);
  }

  @Put('settings')
  @RequireTenantPermissions('tenant.finance.read', 'tenant.finance.settings.manage')
  @ApiOperation({
    summary: 'Replace clinic invoice settings using optimistic version control',
    description:
      'SAR is the initial currency only. Tax and numbering rules must be explicitly configured; no tax, price, or legal invoice field is inferred.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'expectedVersion',
        'currencyCode',
        'lineRounding',
        'customFields',
        'taxPolicies',
        'numberingPolicy',
      ],
    },
  })
  @ApiOkResponse({ description: 'Settings updated and revision recorded' })
  @ApiBadRequestResponse({ description: 'Settings are invalid' })
  @ApiConflictResponse({ description: 'Settings version changed or audit capacity is reached' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Finance settings permission is required' })
  saveSettings(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(updateClinicFinanceSettingsSchema))
    body: UpdateClinicFinanceSettingsInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.finance.updateSettings(context, body, actor);
  }

  @Get('invoices')
  @RequireTenantPermissions('tenant.finance.read')
  @ApiOperation({ summary: 'Search invoices for the trusted tenant' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'REVIEWED', 'ISSUED'] })
  @ApiQuery({ name: 'search', required: false, type: String, maxLength: 100 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0, maximum: 100_000 })
  @ApiOkResponse({ description: 'Tenant invoice page returned' })
  @ApiBadRequestResponse({ description: 'Invoice filters are invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant finance read permission is required' })
  listInvoices(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query(new ZodValidationPipe(listClinicInvoicesQuerySchema)) query: ListClinicInvoicesQuery,
  ) {
    return this.finance.listInvoices(context, query);
  }

  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.finance.manage')
  @ApiOperation({ summary: 'Create a tenant-owned invoice draft' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiCreatedResponse({ description: 'Draft created or returned for an idempotent retry' })
  @ApiBadRequestResponse({ description: 'Invoice draft or idempotency key is invalid' })
  @ApiConflictResponse({ description: 'Idempotency key conflicts with a different draft' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant invoice management permission is required' })
  createInvoice(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Body(new ZodValidationPipe(createClinicInvoiceSchema)) body: CreateClinicInvoiceInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    if (Array.isArray(idempotencyKey)) {
      throw new ClinicFinanceInputError();
    }
    return this.finance.createInvoice(context, body, actor, idempotencyKey);
  }

  @Get('invoices/:invoiceId')
  @RequireTenantPermissions('tenant.finance.read')
  @ApiOperation({ summary: 'Read an invoice and its audit history' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiOkResponse({ description: 'Invoice returned' })
  @ApiBadRequestResponse({ description: 'Invoice identifier is invalid' })
  @ApiNotFoundResponse({ description: 'Invoice was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant finance read permission is required' })
  getInvoice(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('invoiceId', new ZodValidationPipe(clinicInvoiceIdSchema)) invoiceId: string,
  ) {
    return this.finance.getInvoice(context, invoiceId);
  }

  @Patch('invoices/:invoiceId')
  @RequireTenantPermissions('tenant.finance.read', 'tenant.finance.manage')
  @ApiOperation({ summary: 'Update a draft invoice' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({ description: 'Draft updated' })
  @ApiBadRequestResponse({ description: 'Invoice update is invalid' })
  @ApiConflictResponse({ description: 'Invoice version or lifecycle changed' })
  @ApiNotFoundResponse({ description: 'Invoice was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Tenant invoice management permission is required' })
  updateInvoice(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('invoiceId', new ZodValidationPipe(clinicInvoiceIdSchema)) invoiceId: string,
    @Body(new ZodValidationPipe(updateClinicInvoiceSchema)) body: UpdateClinicInvoiceInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.finance.updateInvoice(context, invoiceId, body, actor);
  }

  @Post('invoices/:invoiceId/review')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.finance.read', 'tenant.finance.review')
  @ApiOperation({ summary: 'Validate settings and move a draft to reviewed' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiBody({
    schema: { type: 'object', additionalProperties: false, required: ['expectedVersion'] },
  })
  @ApiOkResponse({ description: 'Invoice reviewed and totals frozen' })
  @ApiBadRequestResponse({ description: 'Review request is invalid' })
  @ApiConflictResponse({ description: 'Invoice state or version changed' })
  @ApiUnprocessableEntityResponse({
    description: 'Required invoice policies or fields are missing',
  })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Invoice review permission is required' })
  reviewInvoice(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('invoiceId', new ZodValidationPipe(clinicInvoiceIdSchema)) invoiceId: string,
    @Body(new ZodValidationPipe(clinicInvoiceTransitionSchema))
    body: { expectedVersion: number },
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.finance.reviewInvoice(context, invoiceId, body, actor);
  }

  @Post('invoices/:invoiceId/return-to-draft')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.finance.read', 'tenant.finance.review')
  @ApiOperation({ summary: 'Return a reviewed invoice for correction with a reason' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiOkResponse({ description: 'Invoice returned to draft' })
  @ApiBadRequestResponse({ description: 'Return request or reason is invalid' })
  @ApiConflictResponse({ description: 'Invoice state or version changed' })
  @ApiNotFoundResponse({ description: 'Invoice was not found in the trusted tenant' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Invoice review permission is required' })
  returnToDraft(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('invoiceId', new ZodValidationPipe(clinicInvoiceIdSchema)) invoiceId: string,
    @Body(new ZodValidationPipe(returnClinicInvoiceToDraftSchema))
    body: { expectedVersion: number; reason: string },
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.finance.returnToDraft(context, invoiceId, body, actor);
  }

  @Post('invoices/:invoiceId/issue')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.finance.read', 'tenant.finance.issue')
  @ApiOperation({
    summary: 'Issue a reviewed invoice; issued financial details become immutable',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiBody({
    schema: { type: 'object', additionalProperties: false, required: ['expectedVersion'] },
  })
  @ApiOkResponse({ description: 'Invoice issued; no payment is collected' })
  @ApiBadRequestResponse({ description: 'Issue request is invalid' })
  @ApiConflictResponse({ description: 'Invoice or numbering policy changed' })
  @ApiNotFoundResponse({ description: 'Invoice was not found in the trusted tenant' })
  @ApiUnprocessableEntityResponse({ description: 'Required invoice policy is not configured' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  @ApiForbiddenResponse({ description: 'Invoice issue permission is required' })
  issueInvoice(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('invoiceId', new ZodValidationPipe(clinicInvoiceIdSchema)) invoiceId: string,
    @Body(new ZodValidationPipe(clinicInvoiceTransitionSchema))
    body: { expectedVersion: number },
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.finance.issueInvoice(context, invoiceId, body, actor);
  }

  @Post('invoices/:invoiceId/transfers')
  @HttpCode(HttpStatus.CREATED)
  @RequireTenantPermissions('tenant.finance.payments.submit')
  @ApiOperation({ summary: 'Submit a transfer receipt for an issued clinic invoice' })
  @ApiCreatedResponse({ description: 'Receipt stored for admin review' })
  @ApiBadRequestResponse({ description: 'Receipt file or request is invalid' })
  @ApiConflictResponse({ description: 'Invoice already has a pending or approved transfer' })
  @ApiUnprocessableEntityResponse({ description: 'Bank transfer is disabled or not configured' })
  submitInvoiceTransfer(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('invoiceId', new ZodValidationPipe(clinicInvoiceIdSchema)) invoiceId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    if (Array.isArray(idempotencyKey)) throw new ClinicFinanceInputError();
    return readReceiptMultipartForm(request).then(({ receipt }) =>
      this.finance.submitInvoiceTransfer(context, invoiceId, receipt, actor, idempotencyKey),
    );
  }

  @Get('invoices/:invoiceId/transfers')
  @RequireTenantPermissions('tenant.finance.payments.read')
  @ApiOperation({ summary: 'List transfer submissions for a tenant invoice' })
  @ApiOkResponse({ description: 'Invoice transfer submissions returned without file bytes' })
  listInvoiceTransfers(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('invoiceId', new ZodValidationPipe(clinicInvoiceIdSchema)) invoiceId: string,
  ) {
    return this.finance.listInvoiceTransfers(context, { invoiceId });
  }

  @Get('transfers')
  @RequireTenantPermissions('tenant.finance.payments.read')
  @ApiOperation({ summary: 'List transfer submissions for the trusted tenant' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] })
  listTransfers(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Query('status', new ZodValidationPipe(clinicInvoiceTransferStatusSchema.optional()))
    status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | undefined,
  ) {
    return this.finance.listInvoiceTransfers(context, { status });
  }

  @Get('transfers/:transferId/receipt')
  @RequireTenantPermissions('tenant.finance.payments.read')
  @ApiOperation({ summary: 'Download a tenant-scoped transfer receipt' })
  async downloadTransferReceipt(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('transferId', new ZodValidationPipe(clinicInvoiceTransferIdSchema)) transferId: string,
    @Res() reply: FastifyReply,
  ) {
    const transfer = await this.finance.getTransferReceipt(context, transferId);
    const fileName = transfer.receiptFileName.replace(/["\\\r\n]/gu, '_').slice(0, 120);
    return reply
      .type(transfer.receiptMimeType)
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(transfer.receiptBytes);
  }

  @Post('transfers/:transferId/approve')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.finance.payments.read', 'tenant.finance.payments.review')
  @ApiOperation({ summary: 'Approve a pending transfer receipt with a reason' })
  @ApiOkResponse({ description: 'Transfer receipt approved and audit event recorded' })
  @ApiBadRequestResponse({ description: 'Review reason or version is invalid' })
  @ApiConflictResponse({ description: 'Transfer is not pending or its version changed' })
  approveTransfer(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('transferId', new ZodValidationPipe(clinicInvoiceTransferIdSchema)) transferId: string,
    @Body(new ZodValidationPipe(reviewClinicInvoiceTransferSchema))
    body: { expectedVersion: number; reason: string },
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.finance.reviewInvoiceTransfer(context, transferId, body, 'APPROVED', actor);
  }

  @Post('transfers/:transferId/reject')
  @HttpCode(HttpStatus.OK)
  @RequireTenantPermissions('tenant.finance.payments.read', 'tenant.finance.payments.review')
  @ApiOperation({ summary: 'Reject a pending transfer receipt with a reason' })
  @ApiOkResponse({ description: 'Transfer receipt rejected and audit event recorded' })
  @ApiBadRequestResponse({ description: 'Review reason or version is invalid' })
  @ApiConflictResponse({ description: 'Transfer is not pending or its version changed' })
  rejectTransfer(
    @CurrentTenantContext() context: TrustedTenantContext,
    @Param('transferId', new ZodValidationPipe(clinicInvoiceTransferIdSchema)) transferId: string,
    @Body(new ZodValidationPipe(reviewClinicInvoiceTransferSchema))
    body: { expectedVersion: number; reason: string },
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.finance.reviewInvoiceTransfer(context, transferId, body, 'REJECTED', actor);
  }
}
