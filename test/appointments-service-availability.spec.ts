import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type ServiceOption = { id: string; name: string };
type ViewInput = Record<string, unknown>;
type ServiceView = {
  status: string;
  services: ServiceOption[];
  message: string;
};
type ServiceAvailabilityApi = {
  view(input: ViewInput): ServiceView;
  apply(
    select: { innerHTML: string; disabled: boolean; value: string },
    status: { textContent: string },
    retry: { hidden: boolean },
    view: ServiceView,
    escapeHtml: (value: string) => string,
  ): void;
  createRequestGuard(): {
    next(): number;
    invalidate(): void;
    isCurrent(requestId: number): boolean;
  };
};

const browserWindow: Record<string, unknown> = {};
runInNewContext(readFileSync('public/appointments/service-availability.js', 'utf8'), {
  window: browserWindow,
});
const picker = browserWindow.ThanarahAppointmentServiceAvailability as ServiceAvailabilityApi;

const doctorId = 'doctor-a';
const facilityId = 'facility-a';
const branchId = 'branch-north';
const assignments = [
  {
    doctorId,
    serviceId: 'facility-service',
    serviceName: 'Consultation',
    serviceStatus: 'ACTIVE',
    facilityId,
    branchId: null,
  },
  {
    doctorId,
    serviceId: 'branch-service',
    serviceName: 'North procedure',
    serviceStatus: 'ACTIVE',
    facilityId,
    branchId,
  },
  {
    doctorId,
    serviceId: 'other-branch-service',
    serviceName: 'South procedure',
    serviceStatus: 'ACTIVE',
    facilityId,
    branchId: 'branch-south',
  },
  {
    doctorId,
    serviceId: 'other-facility-service',
    serviceName: 'Other clinic procedure',
    serviceStatus: 'ACTIVE',
    facilityId: 'facility-b',
    branchId: null,
  },
  {
    doctorId: 'doctor-b',
    serviceId: 'other-doctor-service',
    serviceName: 'Other doctor procedure',
    serviceStatus: 'ACTIVE',
    facilityId,
    branchId: null,
  },
  {
    doctorId,
    serviceId: 'inactive-service',
    serviceName: 'Inactive service',
    serviceStatus: 'INACTIVE',
    facilityId,
    branchId: null,
  },
];

describe('appointment service assignment picker', () => {
  it('shows facility-wide and matching-branch assignments, excluding other doctors and locations', () => {
    const result = picker.view({
      authorized: true,
      doctorId,
      facilityId,
      branchId,
      assignments,
    });

    expect(result.status).toBe('ready');
    expect(result.services).toEqual([
      { id: 'facility-service', name: 'Consultation' },
      { id: 'branch-service', name: 'North procedure' },
    ]);
  });

  it('shows only facility-wide assignments until a branch is selected', () => {
    const result = picker.view({
      authorized: true,
      doctorId,
      facilityId,
      branchId: '',
      assignments,
    });

    expect(result.status).toBe('ready');
    expect(result.services).toEqual([{ id: 'facility-service', name: 'Consultation' }]);
  });

  it('shows explicit selection, loading, empty, error, and unauthorized states', () => {
    expect(picker.view({ authorized: true, doctorId: '', facilityId }).status).toBe(
      'selection-required',
    );
    expect(picker.view({ authorized: true, doctorId, facilityId, loading: true }).status).toBe(
      'loading',
    );
    expect(
      picker.view({
        authorized: true,
        doctorId,
        facilityId,
        assignments: [],
      }),
    ).toMatchObject({ status: 'empty', message: expect.stringContaining('لا توجد خدمات') });
    expect(
      picker.view({
        authorized: true,
        doctorId,
        facilityId,
        errorMessage: 'network',
      }),
    ).toMatchObject({ status: 'error' });
    expect(
      picker.view({
        authorized: false,
        doctorId,
        facilityId,
      }),
    ).toMatchObject({ status: 'unauthorized', services: [] });
  });

  it('clears an old selection while loading and disables choices on errors', () => {
    const select = { innerHTML: '', disabled: false, value: 'branch-service' };
    const status = { textContent: '' };
    const retry = { hidden: true };
    const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

    const loading = picker.view({ authorized: true, doctorId, facilityId, loading: true });
    picker.apply(select, status, retry, loading, escapeHtml);
    expect(select.value).toBe('');
    expect(select.disabled).toBe(true);
    expect(status.textContent).toContain('جارٍ تحميل');

    const error = picker.view({
      authorized: true,
      doctorId,
      facilityId,
      errorMessage: 'network',
    });
    picker.apply(select, status, retry, error, escapeHtml);
    expect(select.value).toBe('');
    expect(select.disabled).toBe(true);
    expect(retry.hidden).toBe(false);
    expect(status.textContent).toContain('تعذّر تحميل');
  });

  it('ignores assignment responses from a previous doctor or location selection', () => {
    const requests = picker.createRequestGuard();
    const previousSelection = requests.next();
    const currentSelection = requests.next();

    expect(requests.isCurrent(previousSelection)).toBe(false);
    expect(requests.isCurrent(currentSelection)).toBe(true);

    requests.invalidate();
    expect(requests.isCurrent(currentSelection)).toBe(false);
  });
});
