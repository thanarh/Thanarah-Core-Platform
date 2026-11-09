import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export class ClinicFinanceInputError extends BadRequestException {
  constructor() {
    super({ code: 'CLINIC_FINANCE_INPUT_INVALID', message: 'Clinic finance input is invalid' });
  }
}

export class ClinicFinanceSettingsConflictError extends ConflictException {
  constructor() {
    super({
      code: 'CLINIC_FINANCE_SETTINGS_CONFLICT',
      message: 'Clinic finance settings changed; reload them before saving',
    });
  }
}

export class ClinicInvoiceNotFoundError extends NotFoundException {
  constructor() {
    super({ code: 'CLINIC_INVOICE_NOT_FOUND', message: 'Invoice was not found in this tenant' });
  }
}

export class ClinicInvoiceStateConflictError extends ConflictException {
  constructor() {
    super({
      code: 'CLINIC_INVOICE_STATE_CONFLICT',
      message: 'Invoice version or lifecycle state prevents this action',
    });
  }
}

export class ClinicInvoiceNumberConflictError extends ConflictException {
  constructor() {
    super({
      code: 'CLINIC_INVOICE_NUMBER_CONFLICT',
      message: 'This invoice number is already used in this tenant',
    });
  }
}

export class ClinicInvoiceIdempotencyConflictError extends ConflictException {
  constructor() {
    super({
      code: 'CLINIC_INVOICE_IDEMPOTENCY_CONFLICT',
      message: 'The idempotency key was used for a different invoice',
    });
  }
}

export class ClinicInvoicePolicyUnavailableError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'CLINIC_INVOICE_POLICY_UNAVAILABLE',
      message: 'Required invoice, tax, currency, or numbering policy is not configured',
    });
  }
}

export class ClinicInvoicePaymentUnavailableError extends UnprocessableEntityException {
  constructor() {
    super({
      code: 'CLINIC_INVOICE_PAYMENT_UNAVAILABLE',
      message: 'Bank transfer is not configured for this invoice',
    });
  }
}

export class ClinicInvoiceTransferNotFoundError extends NotFoundException {
  constructor() {
    super({
      code: 'CLINIC_INVOICE_TRANSFER_NOT_FOUND',
      message: 'Transfer receipt was not found in this tenant',
    });
  }
}

export class ClinicFinanceAuditCapacityError extends ConflictException {
  constructor() {
    super({
      code: 'CLINIC_FINANCE_AUDIT_CAPACITY',
      message: 'The audit history reached its configured capacity and needs operator review',
    });
  }
}
