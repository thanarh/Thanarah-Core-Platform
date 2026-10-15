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

List filters support `from`, `to`, `fromDate`, `toDate`, `search`, `doctorId`,
`facilityId`, `branchId`, `patientId`, `serviceId`, and `status`, plus bounded
`limit` and `offset`. Explicit `from`/`to` timestamps must include a UTC offset
and select appointments overlapping the half-open interval `[from, to)`.
Date-only filters are facility-local: at least one date and `facilityId` are
required, and an active scheduling policy must provide that facility's IANA
timezone. `fromDate` starts at local midnight; `toDate` includes that entire
local day by ending at the next local midnight. DST-short and DST-long days
therefore have their actual elapsed duration. Explicit timestamps and local
dates cannot be mixed. If no active timezone policy exists, date filtering
fails with `APPOINTMENT_TIME_ZONE_UNAVAILABLE`; the server does not substitute
UTC or the caller's browser timezone.

Search is normalized, bounded to 128 characters, and applied before count,
sort, and pagination. A UUID searches appointment and reference identifiers;
an exact patient-ID match is included only when the caller also has
`tenant.patients.read`. Non-UUID text searches the existing patient-directory
fields (patient number, first/middle/last/preferred name, phone, and email) and
requires `tenant.patients.read`. Results contain appointment fields only, never
patient demographics. The Mongo query joins patients within the tenant's
database and scopes both sides by trusted tenant ID; it does not materialize
patient IDs or the appointment collection in application memory. Search/count
and the stable `startsAt ASC, id ASC` ordering are applied before pagination.

The appointment workspace retrieves timezone-only metadata through
`GET /api/v1/tenants/:tenantId/appointments/effective-time-zones?facilityIds=...`
using `tenant.appointments.read`. It returns at most 20 requested, in-scope
facilities and only each facility ID, effective active-policy timezone, and
whether an active policy is absent. This route does not grant access to policy
rules or revision history. Appointment display and local datetime input use
the facility's active policy timezone when present. When no active policy
exists, the UI explicitly labels and uses the browser's own timezone; if that
timezone is unavailable, local-time entry is blocked.

Only `SCHEDULED` appointments can be updated or rescheduled; cancellation
changes the state to `CANCELLED` and cannot be reversed. Repeating cancellation
is idempotent.

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

## Collision protection

Provider overlap checks use half-open intervals: adjacent appointments are
allowed. The tenant MongoDB adapter now serializes booking mutations with unique,
tenant-local lock documents for the provider and facility. Create, reschedule,
appointment updates, and cancellation acquire the same ordered resource locks
before reading overlaps or changing appointment state. Rescheduling also locks
the old and new provider/facility scopes. Policy writes use the facility lock so
a policy cannot change midway through a booking check.

The unique-indexed lock acquisition is a per-tenant-database mutex, not a Mongo
transaction. It prevents two cooperating application writers from both passing
the overlap check while holding the same provider lock. A busy lock or observed
overlap returns HTTP 409 with `APPOINTMENT_SCHEDULE_CONFLICT`. Writes fail
closed if the tenant database or required indexes cannot be verified. Version
checks continue to protect concurrent changes to one appointment.

Create supports an optional `Idempotency-Key` header (1–128 visible ASCII
characters). Its appointment identifier is deterministic within the tenant and
actor scope, so an identical retry returns the original record. Reusing the key
for a different payload returns `APPOINTMENT_IDEMPOTENCY_CONFLICT`.

There is no lock lease or automatic expiry. If a process dies while holding a
lock, subsequent writers fail closed rather than risking an unsafe takeover.
An operator may remove an abandoned lock only after confirming every writer for
that tenant database has stopped and verifying that the lock owner is no longer
active. A failed operation releases only locks matching its own owner token.
This safeguard and concurrency behavior are covered by disposable standalone
MongoDB integration tests; it does not establish the topology or reliability of
any production deployment. No production topology or deployment decision is
made here.

## Facility scheduling policy

Policies are central control-plane records scoped to both tenant and existing
facility; appointment records remain in the tenant MongoDB database. The
policy starts `INACTIVE`, uses optimistic `version` updates, and records each
create, update, activation, and deactivation in revision history. Changes are
audited without patient information. The dedicated
`tenant.appointments.policy.manage` permission is assigned to tenant owners and
admins, not members. Existing custom roles can receive it through role
administration.

| Operation | Route | Permission |
| --- | --- | --- |
| Read policy | `GET /api/v1/tenants/:tenantId/facilities/:facilityId/scheduling-policy` | `tenant.appointments.policy.manage` |
| Create or update policy | `PUT /api/v1/tenants/:tenantId/facilities/:facilityId/scheduling-policy` | `tenant.appointments.policy.manage` |
| Activate policy | `POST .../scheduling-policy/activate` | `tenant.appointments.policy.manage` |
| Deactivate policy | `POST .../scheduling-policy/deactivate` | `tenant.appointments.policy.manage` |
| Read revision history | `GET .../scheduling-policy/history` | `tenant.appointments.policy.manage` |

The request explicitly supplies an IANA `timeZone` and `rules`. Supported
fields are:

- `operatingHours`: weekday lists of local `HH:mm` intervals. An empty object
  does not constrain facility hours; once any weekday is configured, omitted
  weekdays are closed.
- `providerAvailability`: optional doctor-specific weekday schedules and
  date-specific exceptions. Only doctors with an explicit entry receive this
  additional availability check.
- `allowedDurationsMinutes` and `serviceDurationRules`: optional allowed
  elapsed-minute durations, globally or per tenant service.
- `bookingHorizonDays`, `minimumAdvanceNoticeMinutes`,
  `minimumCancellationNoticeMinutes`, and
  `minimumRescheduleNoticeMinutes`: optional integer restrictions.

No timezone, working hours, default duration, notice period, booking horizon,
or provider schedule is inferred. Empty or `null` optional rules are not
enforced. A missing or inactive policy therefore preserves the existing
explicit-start/end behavior. When active, booking hours, configured provider
availability, duration rules, booking horizon, and advance notice are enforced
on create and reschedule; cancellation and rescheduling notice rules are
enforced on their respective mutations. IANA conversion evaluates persisted
instants in the configured zone, including daylight-saving transitions. The
API still requires timestamps with an explicit UTC offset; it does not accept
ambiguous local wall-clock timestamps.

Activation revalidates the active facility and any configured doctor/service
references. Unknown request properties, including physical storage identifiers,
are rejected. Tenant ownership, staff location authorization, and the policy's
business rules remain separate checks.

## Storage and audit operations

Tenant storage activation provisions and verifies the appointment indexes for
provider overlap queries, time-ordered lists, and facility, branch, status, and
patient filters. Existing targets must pass the existing activation/primary
preflight before appointment writes are enabled. Missing or incompatible
indexes fail closed.

Central Prisma stores policy rules/revisions, permission catalog entries, and
audit event types. Appointment records remain in tenant MongoDB. Appointment
audit events include the appointment ID and action, but not the reason, patient
details, or appointment notes. No patient-number or patient duplicate
prevention behavior was changed.

There is no tenant frontend in this repository; the integration boundary is
the versioned API above.
