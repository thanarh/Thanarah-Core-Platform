import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ThanarahApi {
  clearSession(): void;
  login(email: string, password: string): Promise<boolean>;
  listWorkspaces(): Promise<{ items: unknown[] }>;
  listTenantMemberships(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  listTenantRoles(tenantId: string): Promise<unknown>;
  listTenantMembershipRoles(tenantId: string, membershipId: string): Promise<unknown>;
  assignTenantMembershipRole(
    tenantId: string,
    membershipId: string,
    roleId: string,
  ): Promise<unknown>;
  removeTenantMembershipRole(
    tenantId: string,
    membershipId: string,
    roleId: string,
  ): Promise<unknown>;
  listTenantStaff(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  createTenantStaff(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  assignStaffFacilityScope(tenantId: string, staffId: string, facilityId: string): Promise<unknown>;
  assignStaffBranchScope(tenantId: string, staffId: string, branchId: string): Promise<unknown>;
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
  listFacilities(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  listSetupBranches(
    tenantId: string,
    facilityId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  createFacility(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  updateFacility(
    tenantId: string,
    facilityId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  changeFacilityStatus(tenantId: string, facilityId: string, action: string): Promise<unknown>;
  createBranch(
    tenantId: string,
    facilityId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  updateBranch(
    tenantId: string,
    facilityId: string,
    branchId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  changeBranchStatus(
    tenantId: string,
    facilityId: string,
    branchId: string,
    action: string,
  ): Promise<unknown>;
  listDepartments(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  createDepartment(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  updateDepartment(
    tenantId: string,
    departmentId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  changeDepartmentStatus(tenantId: string, departmentId: string, action: string): Promise<unknown>;
  listSpecialties(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  createSpecialty(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  updateSpecialty(
    tenantId: string,
    specialtyId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  changeSpecialtyStatus(tenantId: string, specialtyId: string, action: string): Promise<unknown>;
  listSetupServices(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  createService(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  updateService(
    tenantId: string,
    serviceId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  changeServiceStatus(tenantId: string, serviceId: string, action: string): Promise<unknown>;
  listSetupDoctors(
    tenantId: string,
    options: Record<string, string | number | undefined>,
  ): Promise<unknown>;
  createDoctor(tenantId: string, input: Record<string, unknown>): Promise<unknown>;
  updateDoctor(
    tenantId: string,
    doctorId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  changeDoctorStatus(tenantId: string, doctorId: string, action: string): Promise<unknown>;
  assignDoctorDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<unknown>;
  unassignDoctorDepartment(
    tenantId: string,
    doctorId: string,
    departmentId: string,
  ): Promise<unknown>;
  assignDoctorSpecialty(tenantId: string, doctorId: string, specialtyId: string): Promise<unknown>;
  unassignDoctorSpecialty(
    tenantId: string,
    doctorId: string,
    specialtyId: string,
  ): Promise<unknown>;
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

  it('exposes tenant-scoped facility and branch setup operations without filtering inactive records', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-token' }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'facility-id' }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'facility-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'facility-id' }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'branch-id' }, 201))
      .mockResolvedValueOnce(jsonResponse({ id: 'branch-id' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'branch-id' }));

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listFacilities('tenant-id', { status: 'SUSPENDED', limit: 50, offset: 0 });
    await api.createFacility('tenant-id', { name: 'العيادة' });
    await api.updateFacility('tenant-id', 'facility/id', { name: 'العيادة الرئيسية' });
    await api.changeFacilityStatus('tenant-id', 'facility/id', 'activate');
    await api.listSetupBranches('tenant-id', 'facility/id', { limit: 50, offset: 0 });
    await api.createBranch('tenant-id', 'facility/id', { name: 'الفرع الشمالي' });
    await api.updateBranch('tenant-id', 'facility/id', 'branch/id', { name: 'فرع الشمال' });
    await api.changeBranchStatus('tenant-id', 'facility/id', 'branch/id', 'suspend');

    const requests = fetchMock.mock.calls.slice(1) as [string, RequestInit][];
    expect(Object.fromEntries(new URL(requests[0]![0], 'http://same-origin').searchParams)).toEqual(
      { limit: '50', offset: '0', status: 'SUSPENDED' },
    );
    expect(requests[1]![0]).toBe('/api/v1/tenants/tenant-id/facilities');
    expect(requests[1]![1].method).toBe('POST');
    expect(requests[2]![0]).toBe('/api/v1/tenants/tenant-id/facilities/facility%2Fid');
    expect(requests[2]![1].method).toBe('PATCH');
    expect(requests[3]![0]).toBe('/api/v1/tenants/tenant-id/facilities/facility%2Fid/activate');
    expect(requests[4]![0]).toBe(
      '/api/v1/tenants/tenant-id/facilities/facility%2Fid/branches?limit=50&offset=0',
    );
    expect(requests[5]![0]).toBe('/api/v1/tenants/tenant-id/facilities/facility%2Fid/branches');
    expect(requests[6]![0]).toBe(
      '/api/v1/tenants/tenant-id/facilities/facility%2Fid/branches/branch%2Fid',
    );
    expect(requests[7]![0]).toBe(
      '/api/v1/tenants/tenant-id/facilities/facility%2Fid/branches/branch%2Fid/suspend',
    );
    expect(requests.every(([, options]) => options.credentials === 'include')).toBe(true);
    expect(() => api.changeFacilityStatus('tenant-id', 'facility-id', 'reset')).toThrow(
      'A valid facility lifecycle action is required.',
    );
    expect(() => api.changeBranchStatus('tenant-id', 'facility-id', 'branch-id', 'reset')).toThrow(
      'A valid branch lifecycle action is required.',
    );
  });

  it('uses same-origin authenticated tenant routes for membership, staff, role, and scope setup', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-token' }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(undefined, 201))
      .mockResolvedValueOnce(jsonResponse(undefined, 204))
      .mockResolvedValueOnce(jsonResponse(undefined, 201))
      .mockResolvedValueOnce(jsonResponse(undefined, 201))
      .mockResolvedValueOnce(jsonResponse(undefined, 201));

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listTenantMemberships('tenant-id', { status: 'ACTIVE', limit: 25, offset: 0 });
    await api.listTenantRoles('tenant-id');
    await api.listTenantMembershipRoles('tenant-id', 'member/id');
    await api.assignTenantMembershipRole('tenant-id', 'member/id', 'role/id');
    await api.removeTenantMembershipRole('tenant-id', 'member/id', 'role/id');
    await api.listTenantStaff('tenant-id', { limit: 50, offset: 0 });
    await api.assignStaffFacilityScope('tenant-id', 'staff/id', 'facility/id');
    await api.assignStaffBranchScope('tenant-id', 'staff/id', 'branch/id');

    const requests = fetchMock.mock.calls.slice(1) as [string, RequestInit][];
    expect(requests.map(([url]) => url)).toEqual([
      '/api/v1/tenants/tenant-id/memberships?limit=25&offset=0&status=ACTIVE',
      '/api/v1/tenants/tenant-id/roles',
      '/api/v1/tenants/tenant-id/memberships/member%2Fid/roles',
      '/api/v1/tenants/tenant-id/memberships/member%2Fid/roles/role%2Fid',
      '/api/v1/tenants/tenant-id/memberships/member%2Fid/roles/role%2Fid',
      '/api/v1/tenants/tenant-id/staff?limit=50&offset=0',
      '/api/v1/tenants/tenant-id/staff/staff%2Fid/facilities',
      '/api/v1/tenants/tenant-id/staff/staff%2Fid/branches',
    ]);
    expect(requests.map(([, options]) => options.method || 'GET')).toEqual([
      'GET',
      'GET',
      'GET',
      'POST',
      'DELETE',
      'GET',
      'POST',
      'POST',
    ]);
    expect(requests.every(([, options]) => options.credentials === 'include')).toBe(true);
  });

  it('exposes tenant-scoped catalog CRUD and lifecycle operations', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-token' }));
    for (let i = 0; i < 12; i += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    }

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listDepartments('tenant-id', { status: 'SUSPENDED', limit: 25, offset: 25 });
    await api.createDepartment('tenant-id', { name: 'طب الأسرة', description: 'رعاية عامة' });
    await api.updateDepartment('tenant-id', 'department/id', { name: 'طب الأسرة والعائلة' });
    await api.changeDepartmentStatus('tenant-id', 'department/id', 'activate');
    await api.listSpecialties('tenant-id', { limit: 50, offset: 0 });
    await api.createSpecialty('tenant-id', { name: 'طب الأطفال' });
    await api.updateSpecialty('tenant-id', 'specialty/id', { description: 'وصف' });
    await api.changeSpecialtyStatus('tenant-id', 'specialty/id', 'suspend');
    await api.listSetupServices('tenant-id', { limit: 50, offset: 0 });
    await api.createService('tenant-id', { name: 'استشارة أولية', code: 'CONSULT' });
    await api.updateService('tenant-id', 'service/id', { code: null });
    await api.changeServiceStatus('tenant-id', 'service/id', 'deactivate');

    const requests = fetchMock.mock.calls.slice(1) as [string, RequestInit][];
    expect(requests.map(([url]) => url)).toEqual([
      '/api/v1/tenants/tenant-id/departments?limit=25&offset=25&status=SUSPENDED',
      '/api/v1/tenants/tenant-id/departments',
      '/api/v1/tenants/tenant-id/departments/department%2Fid',
      '/api/v1/tenants/tenant-id/departments/department%2Fid/activate',
      '/api/v1/tenants/tenant-id/specialties?limit=50&offset=0',
      '/api/v1/tenants/tenant-id/specialties',
      '/api/v1/tenants/tenant-id/specialties/specialty%2Fid',
      '/api/v1/tenants/tenant-id/specialties/specialty%2Fid/suspend',
      '/api/v1/tenants/tenant-id/services?limit=50&offset=0',
      '/api/v1/tenants/tenant-id/services',
      '/api/v1/tenants/tenant-id/services/service%2Fid',
      '/api/v1/tenants/tenant-id/services/service%2Fid/deactivate',
    ]);
    expect(requests.map(([, options]) => options.method || 'GET')).toEqual([
      'GET',
      'POST',
      'PATCH',
      'POST',
      'GET',
      'POST',
      'PATCH',
      'POST',
      'GET',
      'POST',
      'PATCH',
      'POST',
    ]);
    expect(requests.every(([, options]) => options.credentials === 'include')).toBe(true);
    expect(() => api.changeDepartmentStatus('tenant-id', 'id', 'reset')).toThrow(
      'A valid department lifecycle action is required.',
    );
    expect(() => api.changeSpecialtyStatus('tenant-id', 'id', 'reset')).toThrow(
      'A valid specialty lifecycle action is required.',
    );
    expect(() => api.changeServiceStatus('tenant-id', 'id', 'reset')).toThrow(
      'A valid service lifecycle action is required.',
    );
  });

  it('exposes tenant-scoped doctor administration and assignment operations', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accessToken: 'memory-token' }));
    for (let i = 0; i < 8; i += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));
    }

    await api.login('staff@example.test', 'not-a-real-password');
    await api.listSetupDoctors('tenant-id', { status: 'SUSPENDED', limit: 25, offset: 0 });
    await api.createDoctor('tenant-id', { staffId: 'staff-id', professionalTitle: 'طبيب' });
    await api.updateDoctor('tenant-id', 'doctor/id', { professionalTitle: 'استشاري' });
    await api.changeDoctorStatus('tenant-id', 'doctor/id', 'activate');
    await api.assignDoctorDepartment('tenant-id', 'doctor/id', 'department/id');
    await api.unassignDoctorDepartment('tenant-id', 'doctor/id', 'department/id');
    await api.assignDoctorSpecialty('tenant-id', 'doctor/id', 'specialty/id');
    await api.unassignDoctorSpecialty('tenant-id', 'doctor/id', 'specialty/id');

    const requests = fetchMock.mock.calls.slice(1) as [string, RequestInit][];
    expect(requests.map(([url]) => url)).toEqual([
      '/api/v1/tenants/tenant-id/doctors?limit=25&offset=0&status=SUSPENDED',
      '/api/v1/tenants/tenant-id/doctors',
      '/api/v1/tenants/tenant-id/doctors/doctor%2Fid',
      '/api/v1/tenants/tenant-id/doctors/doctor%2Fid/activate',
      '/api/v1/tenants/tenant-id/doctors/doctor%2Fid/departments',
      '/api/v1/tenants/tenant-id/doctors/doctor%2Fid/departments/department%2Fid',
      '/api/v1/tenants/tenant-id/doctors/doctor%2Fid/specialties',
      '/api/v1/tenants/tenant-id/doctors/doctor%2Fid/specialties/specialty%2Fid',
    ]);
    expect(requests.every(([, options]) => options.credentials === 'include')).toBe(true);
    expect(() => api.changeDoctorStatus('tenant-id', 'doctor-id', 'reset')).toThrow(
      'A valid doctor lifecycle action is required.',
    );
  });
});
