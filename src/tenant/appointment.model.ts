export const AppointmentStatus = {
  SCHEDULED: 'SCHEDULED',
  CANCELLED: 'CANCELLED',
} as const;

export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export interface AppointmentRecord {
  id: string;
  patientId: string;
  doctorId: string;
  facilityId: string;
  branchId: string | null;
  serviceId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  /** Internal optimistic-concurrency version; it is not returned by the API. */
  version: number;
}

export type AppointmentResponse = Omit<
  AppointmentRecord,
  'createdBy' | 'updatedBy' | 'cancelledBy' | 'version'
>;

export interface AppointmentAccessScope {
  unrestricted: boolean;
  facilityIds: readonly string[];
  branchIds: readonly string[];
}

export interface AppointmentListFilter {
  from?: Date;
  to?: Date;
  search?: string;
  searchPatientRecords?: boolean;
  doctorId?: string;
  facilityId?: string;
  branchId?: string;
  patientId?: string;
  serviceId?: string;
  status?: AppointmentStatus;
  limit: number;
  offset: number;
  accessScope: AppointmentAccessScope;
}

export interface AppointmentListResult {
  items: AppointmentRecord[];
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
}
