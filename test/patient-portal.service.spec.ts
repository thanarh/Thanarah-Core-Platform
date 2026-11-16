import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedPlatformUser } from '../src/auth/auth.types';
import { PatientPortalService } from '../src/tenant/patient-portal.service';
import type { PatientPortalClaim, PatientRecord } from '../src/tenant/patient.model';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '33333333-3333-4333-8333-333333333333';
const patientId = '66666666-6666-4666-8666-666666666666';
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor: AuthenticatedPlatformUser = {
  userId,
  sessionId: '44444444-4444-4444-8444-444444444444',
  tokenVersion: 1,
  platformRoleIds: [],
};

const patient: PatientRecord = {
  id: patientId,
  patientNumber: 'PAT-000001',
  firstName: 'Synthetic',
  middleName: null,
  lastName: 'Patient',
  preferredName: null,
  dateOfBirth: null,
  gender: null,
  phone: '0501234567',
  email: 'patient@example.test',
  nationalId: null,
  address: null,
  status: 'ACTIVE',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
};

function fixture(matches: PatientRecord[] = [patient]) {
  let currentClaim: PatientPortalClaim | null = null;
  const patients = {
    findPortalCandidates: vi
      .fn()
      .mockImplementation(async () =>
        matches.map((entry) => ({ ...entry, portalClaim: currentClaim })),
      ),
    startPortalClaim: vi
      .fn()
      .mockImplementation(
        async (
          _context: unknown,
          _patientId: string,
          _email: string,
          claim: PatientPortalClaim,
        ) => {
          currentClaim = claim;
          return claim;
        },
      ),
    verifyPortalClaim: vi.fn().mockResolvedValue('linked'),
    findPatientByPortalUser: vi.fn().mockResolvedValue(patient),
  };
  const platformUsers = {
    findEmailById: vi.fn().mockResolvedValue(' Patient@Example.test '),
  };
  const tenants = {
    findById: vi.fn().mockResolvedValue({ id: tenantId, status: 'ACTIVE' }),
  };
  const finance = {
    listPatientInvoices: vi.fn().mockResolvedValue([]),
    getPatientPortalPaymentSettings: vi
      .fn()
      .mockResolvedValue({ currencyCode: 'SAR', bankTransfer: null }),
  };
  const audit = { recordAudit: vi.fn().mockResolvedValue(undefined) };
  const config = {
    thanarahApiBaseUrl: 'https://messages.example.test',
    thanarahApiKey: 'synthetic-api-key',
    whatsappOtpHmacSecret: 's'.repeat(40),
  };
  const service = new PatientPortalService(
    patients as never,
    platformUsers as never,
    tenants as never,
    finance as never,
    audit as never,
    config as never,
  );
  return { service, patients, platformUsers, finance, audit, config };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PatientPortalService', () => {
  it('sends a synthetic OTP only to the matched record phone and links after verification', async () => {
    const { service, patients, audit } = fixture();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'synthetic-queue-1' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await service.startClaim(
      tenantId,
      { operationId, consentAccepted: true },
      actor,
    );

    expect(response).toMatchObject({ status: 'CHECK_PHONE', challengeId: operationId });
    expect(response.message).not.toContain(patient.phone);
    expect(response.message).not.toContain(patient.email);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as { to: string; text: string };
    expect(payload.to).toBe('+966501234567');
    const code = payload.text.match(/\b\d{6}\b/u)?.[0];
    expect(code).toMatch(/^\d{6}$/u);
    expect(patients.startPortalClaim).toHaveBeenCalledOnce();

    await expect(
      service.verifyClaim(tenantId, { challengeId: operationId, code: code! }, actor),
    ).resolves.toEqual({ verified: true });
    expect(patients.verifyPortalClaim).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, platformUserId: userId }),
      patientId,
      operationId,
      expect.stringMatching(/^[a-f0-9]{64}$/u),
      expect.any(Date),
    );
    expect(audit.recordAudit).toHaveBeenCalledOnce();
  });

  it('returns the same generic response and sends nothing when the account email does not match', async () => {
    const { service, patients } = fixture([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await service.startClaim(
      tenantId,
      { operationId, consentAccepted: true },
      actor,
    );

    expect(response).toMatchObject({ status: 'CHECK_PHONE', challengeId: operationId });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(patients.startPortalClaim).not.toHaveBeenCalled();
  });

  it('fails closed when the approved message channel is not configured', async () => {
    const fixtureState = fixture();
    fixtureState.config.thanarahApiKey = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await fixtureState.service.startClaim(
      tenantId,
      { operationId, consentAccepted: true },
      actor,
    );

    expect(response.status).toBe('CHECK_PHONE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fixtureState.patients.startPortalClaim).not.toHaveBeenCalled();
  });
});
