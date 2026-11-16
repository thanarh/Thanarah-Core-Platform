import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  Req,
  Headers,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { PlatformAuthGuard } from '../auth/guards/platform-auth.guard';
import { CurrentPlatformUser } from '../auth/decorators/current-platform-user.decorator';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PatientPortalService } from './patient-portal.service';
import {
  startPatientPortalClaimSchema,
  verifyPatientPortalClaimSchema,
  type StartPatientPortalClaimInput,
  type VerifyPatientPortalClaimInput,
} from './patient-portal.dto';
import type { FastifyRequest } from 'fastify';
import { readReceiptMultipartForm, ReceiptUploadInvalidError } from '../common/receipt-upload';
import { ClinicFinanceInputError } from './clinic-finance.errors';

@ApiTags('Patient Portal')
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller(`${APP_CONSTANTS.apiVersion}/patient-portal/tenants/:tenantId`)
export class PatientPortalController {
  constructor(private readonly portal: PatientPortalService) {}

  @Post('claim')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start secure patient-record ownership verification',
    description:
      'Matches the authenticated account email to one active patient record, then sends an OTP only to that record’s stored phone. The response does not disclose whether a match exists.',
  })
  @ApiAcceptedResponse({ description: 'A generic verification response is returned' })
  @ApiBadRequestResponse({ description: 'The request or consent is invalid' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  startClaim(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(startPatientPortalClaimSchema))
    body: StartPatientPortalClaimInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.portal.startClaim(tenantId, body, actor);
  }

  @Post('claim/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify an OTP to link the account to one patient record' })
  @ApiOkResponse({ description: 'The account is linked after successful OTP verification' })
  @ApiBadRequestResponse({ description: 'The code is invalid, expired, or locked' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  verifyClaim(
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(verifyPatientPortalClaimSchema))
    body: VerifyPatientPortalClaimInput,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.portal.verifyClaim(tenantId, body, actor);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List issued invoices belonging to the verified patient record' })
  @ApiOkResponse({ description: 'Only invoices linked to the verified patient are returned' })
  @ApiForbiddenResponse({ description: 'Patient ownership must be verified first' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  listInvoices(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.portal.listInvoices(tenantId, actor);
  }

  @Get('invoices/:invoiceId')
  @ApiOperation({ summary: 'Read one issued invoice belonging to the verified patient' })
  @ApiOkResponse({ description: 'Patient invoice details and configured transfer instructions' })
  @ApiForbiddenResponse({ description: 'Patient ownership must be verified first' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  getInvoice(
    @Param('tenantId') tenantId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
  ) {
    return this.portal.getInvoice(tenantId, invoiceId, actor);
  }

  @Post('invoices/:invoiceId/transfers')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a bank-transfer receipt for the patient’s issued invoice' })
  @ApiCreatedResponse({ description: 'Receipt was stored for clinic review' })
  @ApiBadRequestResponse({ description: 'Receipt file or request is invalid' })
  @ApiConflictResponse({ description: 'A transfer is already pending or approved' })
  @ApiForbiddenResponse({ description: 'Patient ownership must be verified first' })
  @ApiUnauthorizedResponse({ description: 'Platform authentication is required' })
  submitInvoiceTransfer(
    @Param('tenantId') tenantId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentPlatformUser() actor: AuthenticatedPlatformUser,
    @Req() request: FastifyRequest,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    if (Array.isArray(idempotencyKey)) throw new ClinicFinanceInputError();
    return readReceiptMultipartForm(request).then(({ receipt, fields }) => {
      if (Object.keys(fields).length) throw new ReceiptUploadInvalidError();
      return this.portal.submitInvoiceTransfer(tenantId, invoiceId, receipt, actor, idempotencyKey);
    });
  }
}
