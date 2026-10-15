# Tenant appointment scheduling

Appointment records are stored in each tenant's MongoDB database, in the
`appointments` collection. Every query and mutation is constrained by the
trusted tenant context. Patient demographics are not copied into appointment
records or API responses. The optional reason is plain text and is not included
in audit metadata.

## API

All routes use `/api/v1/tenants/:tenantId/appointments` and the existing
platform authentication and tenant authorization guards:

| Operation | Route | Permission |
| --- | --- | --- |
| Create | `POST /appointments` | `tenant.appointments.create` |
| List | `GET /appointments` | `tenant.appointments.read` |
| Read | `GET /appointments/:appointmentId` | `tenant.appointments.read` |
| Update non-scheduling fields | `PATCH /appointments/:appointmentId` | `tenant.appointments.update` |
| Reschedule or relocate | `POST /appointments/:appointmentId/reschedule` | `tenant.appointments.reschedule` |
| Cancel | `POST /appointments/:appointmentId/cancel` | `tenant.appointments.cancel` |

List filters support `from`, `to`, `doctorId`, `facilityId`, `branchId`,
`patientId`, and `status`, plus `limit` and `offset`. A date range selects
appointments overlapping the half-open interval `[from, to)`. Timestamps must
include a UTC offset. Only `SCHEDULED` appointments can be updated or
rescheduled; cancellation changes the state to `CANCELLED` and cannot be
reversed. Repeating cancellation is idempotent.

Owners and admins receive all appointment permissions. Members receive
read-only appointment permission. Existing custom roles can be assigned the
new permissions through tenant role administration.

## Reference and location checks

Patient, doctor, facility, branch, and optional service references are resolved
inside the trusted tenant. Patients, doctors, facilities, and services must be
active. A branch must be active and belong to the selected facility. Doctors
must have an active Staff facility or applicable branch assignment.

Staff appointment access uses the existing effective facility/branch scope:
facility assignments include appointments at that facility; branch-only
assignments include appointments at the assigned branch. A staff account with
no active location assignments has no appointment location access. A tenant
member without a Staff profile continues to use tenant permissions without a
location restriction because the existing membership role model has no
facility/branch grant.

## Collision and availability limitations

The service rejects a booking if a query finds an overlapping `SCHEDULED`
appointment for the same provider anywhere in that tenant. Rescheduling excludes
the appointment being moved. Adjacent appointments are allowed; the interval
must only have a positive duration.

This is a preflight query followed by a separate write, not an atomic
reservation. Concurrent requests can both observe no conflict and then both
insert overlapping appointments. Optimistic version checks protect updates to
the same appointment, but do not prevent two new bookings from racing. The
MongoDB test environment is standalone and no approved atomic booking
mechanism, replica-set topology, shard key, or serialization service exists in
the project. A product/infrastructure decision is required before promising
race-safe booking.

No provider or facility availability, business hours, standard duration, slot
size, cancellation window, or grace period is configured in the existing
system. The API therefore does not infer those rules; it validates explicit
start/end timestamps only.

## Storage and audit operations

Tenant storage activation provisions and verifies the appointment indexes for
provider overlap queries, time-ordered lists, and facility, branch, status, and
patient filters. Existing targets must pass the existing activation/primary
preflight before appointment writes are enabled. Missing or incompatible
indexes fail closed.

Central Prisma stores only the new permission catalog entries and appointment
audit event types. Appointment records remain in tenant MongoDB. Audit events
include the appointment ID and action, but not the reason, patient details, or
appointment notes.

There is no tenant frontend in this repository; the integration boundary is
the versioned API above.
