import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ThanarahApi {
  clearSession(): void;
  login(email: string, password: string): Promise<boolean>;
  listWorkspaces(): Promise<{ items: unknown[] }>;
  listAppointments(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  getAppointmentTimeZones(tenantId: string, facilityIds: string[]): Promise<{ items: unknown[] }>;
  createAppointment(
    tenantId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown>;
  listPatients(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  getPatient(tenantId: string, patientId: string): Promise<unknown>;
  createPatient(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  updatePatient(
    tenantId: string,
    patientId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  activatePatient(tenantId: string, patientId: string): Promise<unknown>;
  deactivatePatient(tenantId: string, patientId: string): Promise<unknown>;
}

runInThisContext(readFileSync('public/appointments/api.js', 'utf8'));
const api = (globalThis as typeof globalThis & { ThanarahApi: ThanarahApi }).ThanarahApi;
const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Thanarah browser API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api.clearSession();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    api.clearSession();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('keeps the access token in memory and uses the refresh cookie with same-origin requests', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-only-token' }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listWorkspaces();

    const [loginUrl, loginOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [workspaceUrl, workspaceOptions] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(loginUrl).toBe('/api/v1/auth/login');
    expect(loginOptions.credentials).toBe('include');
    expect(JSON.parse(String(loginOptions.body))).toEqual({
      email: 'staff@example.test',
      password: 'not-a-real-password',
    });
    expect(workspaceUrl).toBe('/api/v1/session/tenants');
    expect(workspaceOptions.credentials).toBe('include');
    expect(new Headers(workspaceOptions.headers).get('authorization')).toBe(
      'Bearer memory-only-token',
    );
  });

  it('refreshes once after an expired access token and retries the original request', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'expired-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'AUTH_TOKEN_EXPIRED' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'rotated-token' }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listWorkspaces();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/session/tenants');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/auth/refresh');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    expect(
      new Headers((fetchMock.mock.calls[3]?.[1] as RequestInit).headers).get('authorization'),
    ).toBe('Bearer rotated-token');
  });

  it('sends tenant-scoped filters and stable idempotency keys without putting them in the body', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-token' }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, limit: 25, offset: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'appointment-id' }, 201))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listAppointments('tenant-id', {
      fromDate: '2026-10-15',
      toDate: '2026-10-16',
      facilityId: 'facility-id',
      search: 'Layla Noor',
      serviceId: 'service-id',
      status: 'SCHEDULED',
      limit: 25,
      offset: 0,
    });
    await api.createAppointment(
      'tenant-id',
      { patientId: 'patient-id', startsAt: '2026-10-15T09:00:00.000Z' },
      'stable-create-retry-key',
    );
    await api.getAppointmentTimeZones('tenant-id', ['facility-a', 'facility-b', 'facility-a']);

    const [listUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [createUrl, createOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
    const [timeZoneUrl] = fetchMock.mock.calls[3] as [string, RequestInit];
    const listUrlObject = new URL(listUrl, 'http://same-origin');
    expect(listUrlObject.pathname).toBe('/api/v1/tenants/tenant-id/appointments');
    expect(Object.fromEntries(listUrlObject.searchParams)).toEqual({
      fromDate: '2026-10-15',
      toDate: '2026-10-16',
      facilityId: 'facility-id',
      search: 'Layla Noor',
      serviceId: 'service-id',
      status: 'SCHEDULED',
      limit: '25',
      offset: '0',
    });
    const timeZoneUrlObject = new URL(timeZoneUrl, 'http://same-origin');
    expect(timeZoneUrlObject.pathname).toBe(
      '/api/v1/tenants/tenant-id/appointments/effective-time-zones',
    );
    expect(timeZoneUrlObject.searchParams.get('facilityIds')).toBe('facility-a,facility-b');
    expect(createUrl).toBe('/api/v1/tenants/tenant-id/appointments');
    expect(new Headers(createOptions.headers).get('idempotency-key')).toBe(
      'stable-create-retry-key',
    );
    expect(JSON.parse(String(createOptions.body))).toEqual({
      patientId: 'patient-id',
      startsAt: '2026-10-15T09:00:00.000Z',
    });
  });

  it('maps conflicts to safe client messages instead of exposing server error text', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-token' }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 'APPOINTMENT_SCHEDULE_CONFLICT', message: 'internal storage detail' } },
          409,
        ),
      );

    await api.login('staff@example.test', 'not-a-real-password');
    await expect(api.listAppointments('tenant-id', {})).rejects.toMatchObject({
      status: 409,
      code: 'APPOINTMENT_SCHEDULE_CONFLICT',
      message: 'هذا الوقت لم يعد متاحًا. اختر وقتًا آخر.',
    });
  });

  it('exposes tenant-scoped patient directory and lifecycle requests through the shared client', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-token' }))
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, limit: 25, offset: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'patient-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'patient-id' }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'patient-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'patient-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'patient-id' }));

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listPatients('tenant-id', { search: 'ليان', status: 'ACTIVE', limit: 25, offset: 0 });
    await api.getPatient('tenant-id', 'patient/id');
    await api.createPatient('tenant-id', { patientNumber: 'P-100', firstName: 'ليان' });
    await api.updatePatient('tenant-id', 'patient/id', { phone: '+966 500000000' });
    await api.deactivatePatient('tenant-id', 'patient/id');
    await api.activatePatient('tenant-id', 'patient/id');

    const requests = fetchMock.mock.calls.slice(1) as [string, RequestInit][];
    expect(new URL(requests[0]![0], 'http://same-origin').pathname).toBe(
      '/api/v1/tenants/tenant-id/patients',
    );
    expect(Object.fromEntries(new URL(requests[0]![0], 'http://same-origin').searchParams)).toEqual(
      {
        search: 'ليان',
        status: 'ACTIVE',
        limit: '25',
        offset: '0',
      },
    );
    expect(requests[1]![0]).toBe('/api/v1/tenants/tenant-id/patients/patient%2Fid');
    expect(requests[2]![0]).toBe('/api/v1/tenants/tenant-id/patients');
    expect(requests[2]![1].method).toBe('POST');
    expect(JSON.parse(String(requests[2]![1].body))).toEqual({
      patientNumber: 'P-100',
      firstName: 'ليان',
    });
    expect(requests[3]![1].method).toBe('PATCH');
    expect(requests[4]![0]).toBe('/api/v1/tenants/tenant-id/patients/patient%2Fid/deactivate');
    expect(requests[4]![1].method).toBe('POST');
    expect(requests[5]![0]).toBe('/api/v1/tenants/tenant-id/patients/patient%2Fid/activate');
    expect(requests.every(([, options]) => options.credentials === 'include')).toBe(true);
  });
});
