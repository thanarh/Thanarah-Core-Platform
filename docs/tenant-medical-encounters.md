# Tenant Medical Encounters

Phase 41 adds a tenant-scoped encounter and clinical documentation module. It
does not add a central clinical-content table, prescriptions, orders, referrals,
insurance claims, billing, or an assumed diagnosis code system.

## Storage and consistency

- Encounter documents live in each registered tenant MongoDB target's
  `encounters` collection. The central Prisma database stores only permission
  definitions and operational audit metadata.
- Repository methods require `TrustedTenantContext`. Tenant identity is taken
  from that context and included in every MongoDB filter; clients cannot select
  a physical database, registry target, or connection string.
- Storage routing currently requires exactly one active primary placement.
  Multi-placement routes fail closed; no sharding, relocation, or migration is
  introduced.
- Target activation provisions encounter indexes after patient and appointment
  indexes, before the registry transition. Encounter reads and writes verify
  the required encounter index definitions and return an unavailable error if
  readiness is lost.
- The MongoDB document update is atomic for clinical content, version metadata,
  and its embedded change-history event. The unique partial appointment index
  prevents two non-cancelled encounters from linking to the same tenant
  appointment, including concurrent creates. A cancelled encounter remains
  stored and no longer reserves that appointment.
- There is no cross-database transaction. Central `PlatformAuditLog` writes
  happen after the MongoDB write and use the existing best-effort audit service.
  Audit failure does not roll back a clinical write. The embedded MongoDB
  history still records the successful mutation, but neither store is claimed
  to be immutable or legally compliant.

## Lifecycle

```text
DRAFT ──complete──> COMPLETED
  └─────cancel────> CANCELLED
```

Only a draft can be documented, completed, or cancelled. A completed original
revision is immutable; Phase 42 adds a separate reasoned amendment workflow.
Cancelled encounters remain immutable. Cancellation retains the encounter and
its history; it never deletes the clinical document. No required clinical fields
are fabricated to permit completion.

An encounter may be created from an appointment only while that appointment is
`SCHEDULED`; the caller also needs appointment-read permission. Direct creation
is separately permissioned and validates active patient, doctor, facility, and
optional branch references, staff assignment of the doctor to the location,
and the caller's location scope. After creation, those references are
immutable.

## Clinical document and validation

Clinical fields are stored separately from encounter administration metadata:

- Reason, chief complaint, history of present illness, review of systems,
  examination findings, assessment, legacy free-text diagnoses, plan,
  follow-up, and internal notes.
- Medical history, allergies, medication history, and review of systems may be
  explicitly `UNKNOWN`, explicitly `NEGATIVE`, or `DOCUMENTED` with text.
  An absent field remains distinct from either explicit state.
- Vital measurements always include units: blood pressure in `mmHg`, heart rate
  in `bpm`, respiratory rate in `breaths/min`, temperature in `°C` or `°F`,
  oxygen saturation in `%`, height in `cm`, and weight in `kg`.
- Diagnoses are documented text only. Phase 42 adds structured descriptions,
  priority, clinical status, and onset time; it intentionally adds no
  standardized codes or code-system fields.

Text fields are normalized to Unicode NFKC, have line endings normalized, reject
control characters, and are limited to 8,000 characters. A clinical patch is
limited to 48 KiB. Legacy free-text diagnosis values remain stored but cannot be
edited through the coded-diagnosis API. Structured diagnosis payloads are
limited to 100 entries and 48 KiB, with exactly one primary diagnosis when the
list is non-empty. Cancel reasons are optional and limited to 500 characters.
Vital values are finite numbers:

| Measurement | Accepted range |
|---|---:|
| Systolic/diastolic pressure | 0–1,000 mmHg |
| Heart/respiratory rate | 0–1,000 |
| Temperature | −100–200 °C or −148–392 °F |
| Oxygen saturation | 0–100% |
| Height | 0–1,000 cm |
| Weight | 0–10,000 kg |

Clinical updates accept `expectedVersion`. The version comparison, patch, and
history append are one MongoDB compare-and-set operation. A stale version
returns a conflict instead of overwriting another writer. Missing patch fields
are retained; `null` clears a supplied field. Patient, appointment, provider,
facility, branch, tenant, and author identities cannot be changed by a clinical
patch.

## Indexes

Index definitions are in `MongoTenantEncounterStorage` and are verified by
name, key order, uniqueness, and partial-filter expression:

- `{_tenantId, _id}` unique encounter identifier.
- `{_tenantId, appointmentId}` unique only for `DRAFT` and `COMPLETED` records.
- `{_tenantId, appointmentId, encounterAt, _id}` for appointment-linked list
  and search queries, including retained cancelled encounters.
- Patient/date, doctor/date, facility/date, facility/branch/date, and
  status/date indexes with stable `_id` sort fields.

The compound indexes support the implemented filters and descending encounter
time pagination. No sharding guarantee is inferred from these indexes.

## Authorization and privacy

All codes below use the tenant permission namespace. Existing `OWNER` roles
receive the new codes through the additive migration. Existing `ADMIN` and
`MEMBER` roles do not receive clinical access automatically; custom role grants
must be assigned deliberately.

| Permission | Purpose |
|---|---|
| `tenant.encounters.create` | Create from an eligible appointment |
| `tenant.encounters.create.direct` | Create without an appointment |
| `tenant.encounters.read` | Read detail and list non-clinical summaries |
| `tenant.encounters.patient-history.read` | Read paginated patient clinical history |
| `tenant.encounters.clinical.write` | Edit draft clinical fields; also requires encounter read |
| `tenant.encounters.complete` | Complete a draft; also requires encounter read |
| `tenant.encounters.cancel` | Cancel a draft; also requires encounter read |
| `tenant.encounters.history.read` | Read lifecycle/change metadata; also requires encounter read |
| `tenant.encounters.diagnoses.read` | Read structured diagnoses |
| `tenant.encounters.diagnoses.write` | Replace structured diagnoses on drafts or open amendments |
| `tenant.encounters.services.read` | Read clinical service/procedure records |
| `tenant.encounters.services.write` | Replace clinical service/procedure records on drafts or open amendments |
| `tenant.encounters.amendments.create` | Open a reasoned amendment for a completed encounter |
| `tenant.encounters.amendments.update` | Edit the current amendment draft |
| `tenant.encounters.amendments.finalize` | Finalize the current amendment |

Appointment access never grants clinical access. Direct and appointment-linked
creation, listing, details, patient history, updates, lifecycle transitions,
and history each have server-side permission checks. Staff facility/branch
scope is enforced by the service and by tenant-scoped query filters. Out-of-scope
detail IDs return the same not-found response as missing records.

List responses intentionally omit clinical content. Patient-history responses
include the documented clinical record only with the dedicated history
permission. Encounter detail requires both structured-diagnosis-read and
service-record-read permissions; this prevents partial detail responses from
revealing either section to users missing its read grant. The workspace uses
the existing session API and keeps clinical content in memory only; it does not
write clinical data to local or session storage, analytics, or URL parameters.
User text is HTML-escaped before rendering.

The embedded history and central audit metadata contain the actor, timestamps,
versions, action, and changed field names—not clinical values, notes, patient
demographics, amendment reasons, or authentication data. The amendment reason
is retained on the amendment itself. The central audit event identifies the
encounter and facility only. Existing audit persistence is best-effort and logs
only a generic persistence warning on failure.

## API

All endpoints are under `/api/v1/tenants/:tenantId`:

| Method and path | Permission |
|---|---|
| `POST /encounters/from-appointment` | Encounter create + appointment read |
| `POST /encounters/direct` | Encounter create + direct create |
| `GET /encounters` | Encounter read |
| `GET /encounters/effective-time-zones?facilityIds=...` | Encounter read |
| `GET /patients/:patientId/encounters` | Patient-history read |
| `GET /encounters/:encounterId` | Encounter read |
| `PATCH /encounters/:encounterId/clinical` | Encounter read + clinical write |
| `POST /encounters/:encounterId/complete` | Encounter read + complete |
| `POST /encounters/:encounterId/cancel` | Encounter read + cancel |
| `GET /encounters/:encounterId/history` | Encounter read + history read |
| `PUT /encounters/:encounterId/diagnoses` | Encounter read + both diagnosis read and write |
| `PUT /encounters/:encounterId/services` | Encounter read + both service-record read and write |
| `POST /encounters/:encounterId/amendments` | Encounter read + both detail read grants + amendment create |
| `PATCH /encounters/:encounterId/amendments/:amendmentId` | Encounter read + both detail read grants + amendment update + write grant for each edited section |
| `POST /encounters/:encounterId/amendments/:amendmentId/finalize` | Encounter read + both detail read grants + amendment finalize |

Pagination is bounded to 100 records per request and sorted by encounter time
descending, then identifier descending. Timestamp filters use explicit offsets.
The optional `search` filter is an exact UUID match against encounter,
appointment, patient, or doctor identifiers; it never searches clinical text.
Date-only filters require an active scheduling policy timezone for the selected
facility; both local endpoints are inclusive and are converted by the existing
timezone utility. Browser timezone is used only to format displayed timestamps,
not to define API date semantics.

Patient-history timestamps are currently formatted using the explicitly
labeled device timezone because a patient can have encounters across facilities;
this affects display only, not data access or API filtering.

## Phase 42: structured records, amendments, and recovery

Structured diagnoses are clinician-entered descriptions with one required
primary diagnosis for each non-empty list, optional secondary diagnoses,
clinical status, and onset time. The request schema rejects code and code-system
fields. No terminology validation or billing behavior is inferred.

Clinical service/procedure records reference the tenant's existing Service
catalog and an active, location-assigned provider. The server checks tenant,
active status, facility/branch assignment, and caller location scope before
writing. Records snapshot the validated service name/code and provider identity
for historical context. Workflow states are `PLANNED`, `IN_PROGRESS`,
`COMPLETED`, and `CANCELLED`; invalid transitions fail with a conflict. No
claims, billing, medication, payment, or inventory side effects are introduced.

Draft encounters accept optimistic-version updates to diagnoses and service
records. Completion freezes the original revision. To correct it, an authorized
user opens one amendment draft with a required reason, edits its separate
clinical/diagnosis/service snapshot, and explicitly finalizes it. The original
root snapshot is preserved. Corrections to terminal service rows are permitted
only in an open amendment; ordinary draft updates cannot silently revise a
completed or cancelled service row. A finalized amendment becomes the current
revision, and another amendment starts from that revision.

Each encounter mutation uses a MongoDB compare-and-set on its expected version;
the clinical data, version, and metadata-only embedded history event are one
atomic document update. Concurrent or repeated stale submissions return a
conflict. After a conflict, reload the encounter, inspect the current version,
and apply the intended change to the latest state rather than replaying the old
payload. If the client loses the response to a write, read the encounter before
retrying because the atomic update may already have succeeded.

Service/provider references live in the central MySQL catalog while encounter
clinical content lives in tenant MongoDB. Reference validation completes before
the MongoDB write; there is no distributed transaction, so catalog changes can
race after validation. The encounter stores a name/code snapshot to preserve
what was validated at write time. Central audit persistence occurs after the
MongoDB write and is best-effort. If an audit write fails, the clinical change
is not rolled back; use the encounter's embedded history to confirm the
successful operation. Neither store is represented as immutable or legally
compliant.

Encounter reads/writes require the configured MongoDB indexes. If readiness is
missing or MongoDB is unavailable, operations fail closed and do not fall back
to another database or an in-memory store. Restore the configured tenant target
and run its normal index-provisioning/activation path, then reload the encounter
before retrying. Never use production databases for disposable integration
tests or substitute direct token signing for real login.

## Workspace and testing

The Arabic RTL workspace is available at `/encounters/` and is linked from the
appointments navigation only for users with encounter-read permission. It
supports date navigation, facility/branch/patient/provider/state filters,
appointment-linked and direct draft creation, clinical documentation, vital
sign units, structured diagnoses, service/procedure records, explicit
completion/cancellation confirmations, reasoned amendment editing/finalization,
version-conflict recovery, and patient history pagination.

Run unit tests with `npm test`. The disposable MongoDB/MySQL integration suite
is `npm run test:phase42`; it requires the configured local Docker socket and
headless Chromium, signs in through the real password endpoint, and never
targets production. No production migration or deployment is performed from
this workspace.

The Phase 44 browser journey runs as part of that suite (the script name is
retained for compatibility). It uses synthetic users and two disposable
tenants to verify signed-out access to both workspaces, real sign-in and
workspace selection, tenant-scoped patient search, branch-scoped appointment
listing, appointment-to-encounter creation, clinical/diagnosis/service saves,
reload persistence, completion, reasoned amendment, and clinical-data clearing
after session expiry. The appointments-only user can list appointments but is
denied encounter details. No production patient data is used.

The suite does not currently inject a central-MySQL outage during
authentication/permission resolution, browser API timeouts and retries, or
partial failures between MySQL and MongoDB. These failure modes remain outside
the verified browser coverage.

## Phase 45: database failures and safe retries

Transient Prisma connection failures (`P1001`, `P1002`, `P1008`, `P1017`, and
`P2024`) are returned as a generic `503 DATABASE_UNAVAILABLE`. Other unexpected
exceptions remain generic `500` responses. The HTTP error filter logs only a
request identifier and a safe error type/code; it does not log raw exception
messages or stacks. Tenant MongoDB repositories and the client manager translate
storage failures to the sanitized tenant-storage `503` responses. Liveness
remains independent of central-database readiness.

Appointment creation is retryable by a client only when it reuses the same
`Idempotency-Key` and the same request payload. The tenant-scoped deterministic
appointment identifier and Mongo schedule locks prevent a repeated/concurrent
request from creating a second appointment. Reusing a key with different
appointment data is a conflict. Without an idempotency key, a client must first
check appointment state after a timeout instead of assuming the write failed.
Appointment updates use expected versions. Encounter writes use
MongoDB compare-and-set versions and append their metadata-only history in the
same document update; after an ambiguous timeout, read the latest encounter
before deciding whether to resubmit. Do not automatically replay non-idempotent
clinical mutations.

MongoDB driver retryable writes remain bounded by its configured connection and
server-selection timeouts. The application does not add a second retry loop or
retry authorization checks using cached state. A failed release of an appointment
lock returns unavailable and does not remove locks owned by another request.
Locks have no automatic expiry: if a process dies after acquisition, an operator
must inspect the tenant-scoped lock before removing it, because an expiry could
allow overlapping bookings while an old writer is still active.

Cross-store sequences are not distributed transactions:

| Workflow | Sequence and authority | Partial failure / safe recovery |
| --- | --- | --- |
| Appointment creation or mutation | Resolve authorization, catalog and scheduling policy in central MySQL; commit appointment state in tenant MongoDB; attempt a best-effort central audit event. MongoDB is authoritative for appointment state. | A central validation failure prevents the tenant write. A lost response after MongoDB commits is resolved by reading the appointment; creation can be retried with the identical idempotency key. Audit failure does not undo the appointment and is not automatically replayed. |
| Encounter creation or mutation | Validate tenant/catalog/provider references in central MySQL; commit the encounter and its embedded history/version atomically in tenant MongoDB; attempt a best-effort central audit event. MongoDB is authoritative for clinical state. | A central validation failure prevents the tenant write. An ambiguous MongoDB result requires reading the encounter/version before retry. Audit persistence is independent and best-effort; embedded encounter history records the committed mutation. No distributed rollback is attempted. |
| Patient write | Validate central references and authorization; commit patient data in tenant MongoDB with required tenant-scoped unique indexes; attempt central audit. MongoDB is authoritative for patient data. | A duplicate-key conflict is resolved by re-reading the scoped record; a storage outage is not treated as an empty result. Audit failure does not reverse patient data. |

There is no durable cross-store operation ledger, audit outbox, or reconciliation
worker. Encounter audit rows now use the UUID of the corresponding embedded
history event as the MySQL primary key. This makes the source event identity
stable and prevents duplicate rows if the same event is replayed, but it does
not queue failed delivery; duplicate-key replay is not classified as successful
delivery. Patient and appointment audit rows do not yet have a stable source
event identity. Central audit failures remain visible only through a sanitized
application warning and, for encounters, the authoritative tenant-side history.
Operators must use infrastructure logs and tenant records to investigate; the
system still cannot durably detect every missing central audit event.

Phase 45B added a disposable MySQL outage test that enables MySQL `offline_mode`
after creating a fresh authenticated session. Login, refresh, logout, workspace
membership resolution, and a protected patient read return sanitized 503
responses while MySQL is unavailable; refresh failure does not clear the
session cookie. Liveness stays 200, readiness returns 503, and login plus
workspace access succeed again after MySQL is restored. This test found and
fixed a real defect: refresh transaction failures had previously been mapped
to 401, which incorrectly presented a dependency outage as an invalid
credential.

The suite also exercises actual MongoDB authentication/configuration/connect
failures through disposable clients, required-index failures, and normal
tenant-isolated patient, appointment, and encounter operations.

Phase 45C adds disposable MongoDB `failCommand` injection against real HTTP
requests. Patient detail and search, patient encounter history, appointment
listing, and encounter detail reads, plus clinical, diagnosis, service, and
patient-create writes return sanitized `503 TENANT_STORAGE_UNAVAILABLE`
responses when MongoDB rejects the relevant commands. Restoring the server
failpoint returns patient listing to normal; the attempted patient create is
not present. Appointment creation is also retried over HTTP with the same
idempotency key and payload, which returns the same appointment ID; reusing
that key with a different payload returns 409.

An HTTP proxy test forwards an appointment creation to the real app and MongoDB,
confirms the upstream request completed with 201, then drops the response before
the client receives it. Retrying the same key and payload returns the same ID,
and a tenant-scoped MongoDB count confirms one appointment. This proves safe
recovery from a client-visible lost HTTP acknowledgement after the operation
has completed; it does not simulate MongoDB losing its own write acknowledgement.

The signed-in Chromium journey also injects a real MongoDB `findAndModify`
failure while saving an encounter draft. The UI displays an error, preserves
the unsent clinical text, and leaves the persisted encounter at version 1.
After MongoDB recovers, an explicit user retry saves the draft as version 2.
This covers a rejected write before commit.

MongoDB-driver acknowledgement loss, a client disconnect while a server
operation is still processing, and a process-level crash between MySQL and
MongoDB writes remain unverified. Appointment creation or rescheduling,
encounter completion or amendment during the injected outage, browser behavior
for ambiguous post-commit results, and concurrent creation of the same
appointment-linked encounter also remain unverified. The exact disposable
integration command is `npm run test:phase42`; it requires Docker and runs the
full MySQL/MongoDB integration scenario. No clinical record is rolled back to
mimic a distributed transaction, and no exactly-once guarantee is claimed.

There is no shared transaction boundary for a generic audit outbox: clinical
state is authoritative in tenant MongoDB, while platform audit rows are in
central MySQL. A MySQL outbox cannot atomically represent whether an independent
MongoDB write committed, and a replay worker without durable intent and
MongoDB-side evidence could create false audit events. Encounter documents
retain metadata-only history; other audit delivery gaps require a larger
operation/recovery design before automation is safe.

## Phase 46 status: stable encounter audit identity only

This increment reuses each encounter's immutable embedded history-event UUID as
the central audit row ID and verifies the relationship against disposable
MongoDB and MySQL. The existing MySQL primary-key constraint is the deduplication
mechanism; no migration was required. It is limited to encounter audit events.

No operation-ledger table, pre-write marker, audit outbox, retry worker, batch
reconciliation endpoint, or operator-review endpoint was implemented. Thus,
this does not cover failures where the central database is unavailable before
an operation marker could be recorded, does not make a missing audit row
automatically discoverable, and does not prove whether a MongoDB mutation
committed when its acknowledgement is lost. Patient and appointment failure
windows, process interruption, ambiguous retries, concurrent reconciliation,
and tenant-isolation tests for a reconciliation action remain unverified. Phase
46 is not closed; the only added guarantee is deduplicable identity for an
encounter history-backed audit replay.

## Phase 45D: critical failure windows

The disposable suite now covers additional failure windows:

- An authenticated appointment create receives a test-only MongoDB
  `writeConcernError` on the first tenant `insert` command. That command is the
  schedule-lock insert, not the later appointment-document insert. The request
  returns 503; an independent query before retry finds no appointment. The
  same-key retry creates one appointment, a changed payload returns 409, and
  no tenant schedule locks remain. The storage code tracks the exact lock owner
  before sending the insert so cleanup also covers a write that may have
  persisted before its acknowledgement failed. This is a server failpoint
  simulation, not a network-level lost acknowledgement on the appointment
  document.
- Two simultaneous authenticated HTTP requests create an encounter from the
  same eligible appointment. One returns 201 and one 409; an independent
  MongoDB count finds one active linked encounter. A later retry returns 409
  without creating a duplicate. The unique partial index remains the final
  persistence guard.
- MongoDB `findAndModify` failures during encounter completion and amendment
  opening return 503. Independent reads confirm the completion remains a draft
  at version 1 and the failed amendment opening leaves the completed revision
  and empty amendment list unchanged. After recovery, explicit retries complete
  the encounter and open one amendment while preserving the original clinical,
  diagnosis, and service snapshots.
- The signed-in browser journey injects a completion write failure. It verifies
  an error is shown and the record remains a draft, then probes the authorized
  read route after recovery and explicitly retries completion. The earlier
  clinical-save outage case still verifies unsent text retention and explicit
  retry from version 1 to version 2.

The schedule-lock failpoint does not prove that an appointment-document insert
committed while its MongoDB acknowledgement was lost. A client disconnect while
the application is still processing, appointment rescheduling/cancellation
outages, and failure-interrupted concurrent encounter creation remain
unverified. Encounter amendment content updates and finalization under outage,
and browser behavior for an ambiguous post-commit response, also remain
unverified.

Audit delivery remains best-effort. Appointment and encounter state commits in
tenant MongoDB before the central MySQL audit attempt; there is no durable
pending operation record, automatic retry, or reconciliation worker. Encounter
audit rows now use the UUID of the corresponding embedded MongoDB history event
as their MySQL primary key. If an audit write is deliberately replayed with the
same source event ID, MySQL uniqueness prevents a duplicate row. This is an
identity/deduplication aid, not a delivery queue: a crash or MySQL outage after
the MongoDB mutation can still leave no central audit row, and a duplicate-key
replay is not automatically classified as successful delivery.

This stable identity currently applies only to encounter history-backed audit
events. Patient, appointment, scheduling-policy, and other workflows are not
connected to a durable cross-store operation ledger. There is no bounded
reconciliation entry point, worker, or operator-review API. Encounter history
can show that a represented MongoDB mutation occurred, but cannot by itself
recover an absent central event or establish that an unrepresented workflow
committed. No automatic replay, distributed atomicity, or exactly-once
delivery is claimed; investigation remains manual.

Known limitations: production MongoDB topology remains an operator decision.
No automated database provisioning, standardized diagnosis coding, or
regulatory-compliance claim is included.
