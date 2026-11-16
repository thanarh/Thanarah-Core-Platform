import { createHmac } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import {
  PLATFORM_USER_PERSISTENCE,
  TENANT_PERSISTENCE,
  type PlatformUserPersistencePort,
  type TenantPersistencePort,
} from '../persistence/platform-persistence.ports';
import { PlatformAuditEventType } from '../common/domain-enums';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedPatientPortalContext } from './tenant-context.contract';
import type { PatientRepository } from './patient.repository';
import { PATIENT_REPOSITORY } from './patient.repository';
import { ClinicFinanceService } from './clinic-finance.service';
import { ConfigService } from '../config/config.service';
import { TenantNotFoundError } from './tenant.errors';
import type { ReceiptUpload } from '../common/receipt-upload';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OTP_PATTERN = /^\d{6}$/u;
const CHALLENGE_LIFETIME_MS = 5 * 60_000;
const GENERIC_CLAIM_MESSAGE =
  'إذا كان البريد مطابقًا لسجل العيادة، فسيُرسل رمز إلى الجوال المسجل. إن لم يصلك، تواصل مع العيادة.';

@Injectable()
export class PatientPortalService {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(PLATFORM_USER_PERSISTENCE)
    private readonly platformUsers: PlatformUserPersistencePort,
    @Inject(TENANT_PERSISTENCE) private readonly tenants: TenantPersistencePort,
    private readonly finance: ClinicFinanceService,
    private readonly audit: PlatformAuditService,
    private readonly config: ConfigService,
  ) {}

  async startClaim(
    tenantIdCandidate: string,
    input: { operationId: string; consentAccepted: boolean },
    actor: AuthenticatedPlatformUser,
  ): Promise<{
    status: 'CHECK_PHONE';
    challengeId: string;
    expiresInSeconds: number;
    message: string;
  }> {
    const operationId = input?.operationId;
    if (
      !actor?.userId ||
      !UUID_PATTERN.test(actor.userId) ||
      typeof operationId !== 'string' ||
      !UUID_PATTERN.test(operationId) ||
      input.consentAccepted !== true
    ) {
      throw new PatientPortalRequestError();
    }

    const { tenant, context } = await this.createContext(tenantIdCandidate, actor);
    const now = new Date();
    const fallbackExpiry = new Date(now.getTime() + CHALLENGE_LIFETIME_MS);
    const email = normalizeEmail(await this.platformUsers.findEmailById(actor.userId));
    if (!email || !this.canSendOtp()) {
      return genericClaimResponse(operationId);
    }

    const candidates = await this.patients.findPortalCandidates(context, email);
    if (candidates.length !== 1) return genericClaimResponse(operationId);
    const patient = candidates[0];
    if (
      !patient ||
      patient.status !== 'ACTIVE' ||
      normalizeEmail(patient.email) !== email ||
      !patient.phone
    ) {
      return genericClaimResponse(operationId);
    }

    const phone = normalizeE164(patient.phone);
    if (!phone) return genericClaimResponse(operationId);
    const secret = this.config.whatsappOtpHmacSecret;
    const code = deriveOtp(secret, actor.userId, tenant.id, patient.id, operationId, phone);
    const claim = {
      operationId,
      accountUserId: actor.userId,
      codeDigest: otpDigest(secret, operationId, code),
      createdAt: now,
      expiresAt: fallbackExpiry,
      attempts: 0,
      consentAcceptedAt: now,
    };
    const started = await this.patients.startPortalClaim(context, patient.id, email, claim);
    if (typeof started === 'string') return genericClaimResponse(operationId);

    try {
      await this.sendOtp(phone, code, operationId);
    } catch {
      // Keep the same challenge reference for a safe idempotent retry.
    }

    return genericClaimResponse(operationId);
  }

  async verifyClaim(
    tenantIdCandidate: string,
    input: { challengeId: string; code: string },
    actor: AuthenticatedPlatformUser,
  ): Promise<{ verified: true }> {
    if (
      !actor?.userId ||
      !UUID_PATTERN.test(actor.userId) ||
      !UUID_PATTERN.test(input?.challengeId ?? '') ||
      !OTP_PATTERN.test(input?.code ?? '')
    ) {
      throw new PatientPortalRequestError();
    }

    const { tenant, context } = await this.createContext(tenantIdCandidate, actor);
    const email = normalizeEmail(await this.platformUsers.findEmailById(actor.userId));
    if (!email) throw new PatientPortalVerificationError();
    const candidates = await this.patients.findPortalCandidates(context, email);
    if (candidates.length !== 1) throw new PatientPortalVerificationError();
    const patient = candidates[0];
    if (
      !patient?.portalClaim ||
      !patient.phone ||
      patient.portalClaim.operationId !== input.challengeId
    ) {
      throw new PatientPortalVerificationError();
    }
    if (
      patient.portalClaim.accountUserId !== actor.userId ||
      patient.status !== 'ACTIVE' ||
      normalizeEmail(patient.email) !== email
    ) {
      throw new PatientPortalVerificationError();
    }

    const phone = normalizeE164(patient.phone);
    if (!phone) throw new PatientPortalVerificationError();
    const digest = otpDigest(this.config.whatsappOtpHmacSecret, input.challengeId, input.code);
    const result = await this.patients.verifyPortalClaim(
      context,
      patient.id,
      input.challengeId,
      digest,
      new Date(),
    );
    if (result !== 'linked' && result !== 'already-linked') {
      throw new PatientPortalVerificationError();
    }
    if (result === 'linked') {
      await this.audit.recordAudit({
        eventType: PlatformAuditEventType.PATIENT_UPDATED,
        actorUserId: actor.userId,
        sessionId: actor.sessionId,
        subjectTenantId: tenant.id,
        metadata: { targetType: 'PATIENT_PORTAL', action: 'account-linked' },
      });
    }
    return { verified: true };
  }

  async listInvoices(tenantIdCandidate: string, actor: AuthenticatedPlatformUser) {
    const { context } = await this.createContext(tenantIdCandidate, actor);
    const patient = await this.patients.findPatientByPortalUser(context);
    if (!patient) throw new PatientPortalLinkRequiredError();
    const invoices = await this.finance.listPatientInvoices(context, patient.id);
    const settings = await this.finance.getPatientPortalPaymentSettings(context);
    return {
      items: invoices.map((invoice) => ({
        ...invoice,
        bankTransfer:
          settings.bankTransfer?.currencyCode === invoice.currencyCode
            ? settings.bankTransfer
            : null,
      })),
    };
  }

  async getInvoice(tenantIdCandidate: string, invoiceId: string, actor: AuthenticatedPlatformUser) {
    const { context } = await this.createContext(tenantIdCandidate, actor);
    const patient = await this.patients.findPatientByPortalUser(context);
    if (!patient) throw new PatientPortalLinkRequiredError();
    const invoice = await this.finance.getPatientInvoice(context, patient.id, invoiceId);
    const settings = await this.finance.getPatientPortalPaymentSettings(context);
    return {
      ...invoice,
      bankTransfer:
        settings.bankTransfer?.currencyCode === invoice.currencyCode ? settings.bankTransfer : null,
    };
  }

  async submitInvoiceTransfer(
    tenantIdCandidate: string,
    invoiceId: string,
    receipt: ReceiptUpload,
    actor: AuthenticatedPlatformUser,
    idempotencyKey?: string,
  ) {
    const { context } = await this.createContext(tenantIdCandidate, actor);
    const patient = await this.patients.findPatientByPortalUser(context);
    if (!patient) throw new PatientPortalLinkRequiredError();
    return this.finance.submitPatientInvoiceTransfer(
      context,
      patient.id,
      invoiceId,
      receipt,
      actor,
      idempotencyKey,
    );
  }

  private async createContext(
    tenantIdCandidate: string,
    actor: AuthenticatedPlatformUser,
  ): Promise<{
    tenant: NonNullable<Awaited<ReturnType<TenantPersistencePort['findById']>>>;
    context: TrustedPatientPortalContext;
  }> {
    if (!UUID_PATTERN.test(tenantIdCandidate) || !actor?.userId) {
      throw new PatientPortalRequestError();
    }
    const tenant = await this.tenants.findById(tenantIdCandidate.toLowerCase());
    if (!tenant || tenant.status !== 'ACTIVE') throw new TenantNotFoundError();
    return {
      tenant,
      context: Object.freeze({
        tenantId: tenant.id as never,
        platformUserId: actor.userId,
      }) as unknown as TrustedPatientPortalContext,
    };
  }

  private canSendOtp(): boolean {
    return (
      this.config.thanarahApiKey.trim().length > 0 && this.config.whatsappOtpHmacSecret.length >= 32
    );
  }

  private async sendOtp(phone: string, code: string, operationId: string): Promise<void> {
    const endpoint = new URL('/api/whatsapp/messages', this.config.thanarahApiBaseUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.config.thanarahApiKey.trim(),
        'idempotency-key': operationId,
      },
      body: JSON.stringify({
        to: phone,
        type: 'text',
        text: `رمز التحقق من فواتير العيادة: ${code}. صالح لمدة خمس دقائق.`,
        consentReference: operationId,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const payload: unknown = await response.json().catch(() => null);
    if (!queueRequestId(payload)) return;
  }
}

export class PatientPortalRequestError extends BadRequestException {
  constructor() {
    super({
      code: 'PATIENT_PORTAL_REQUEST_INVALID',
      message: 'طلب بوابة المريض غير صالح.',
    });
  }
}

export class PatientPortalVerificationError extends BadRequestException {
  constructor() {
    super({
      code: 'PATIENT_PORTAL_VERIFICATION_FAILED',
      message: 'تعذر التحقق من الرمز. ابدأ طلبًا جديدًا أو تواصل مع العيادة.',
    });
  }
}

export class PatientPortalLinkRequiredError extends ForbiddenException {
  constructor() {
    super({
      code: 'PATIENT_PORTAL_LINK_REQUIRED',
      message: 'تحقق من ملكية سجل المريض قبل عرض الفواتير.',
    });
  }
}

function genericClaimResponse(operationId: string) {
  return {
    status: 'CHECK_PHONE' as const,
    challengeId: operationId,
    expiresInSeconds: 300,
    message: GENERIC_CLAIM_MESSAGE,
  };
}

function normalizeEmail(value: string | null | undefined): string {
  return value?.normalize('NFKC').trim().toLowerCase() ?? '';
}

function normalizeE164(value: string): string | null {
  const raw = value.normalize('NFKC').replace(/[ ().-]/gu, '');
  const international = raw.startsWith('00') ? `+${raw.slice(2)}` : raw;
  const normalized = /^05\d{8}$/u.test(international)
    ? `+966${international.slice(1)}`
    : /^5\d{8}$/u.test(international)
      ? `+966${international}`
      : /^966[1-9]\d{7,11}$/u.test(international)
        ? `+${international}`
        : international;
  return /^\+[1-9]\d{7,14}$/u.test(normalized) ? normalized : null;
}

function deriveOtp(
  secret: string,
  userId: string,
  tenantId: string,
  patientId: string,
  operationId: string,
  phone: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(
      `thanarah:patient-portal-otp:v1:${userId}:${tenantId}:${patientId}:${operationId}:${phone}`,
    )
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

function otpDigest(secret: string, operationId: string, code: string): string {
  return createHmac('sha256', secret)
    .update(`thanarah:patient-portal-verify:v1:${operationId}:${code}`)
    .digest('hex');
}

function queueRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = 'requestId' in payload ? payload.requestId : 'id' in payload ? payload.id : null;
  return typeof value === 'string' && /^[a-z0-9._:-]{1,191}$/iu.test(value) ? value : null;
}
