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

Only a draft can be documented, completed, or cancelled. Completed and cancelled
records cannot be edited or reopened in this phase. There is no amendment or
reopen permission until a separate controlled, audited workflow is defined.
Cancellation retains the encounter and its history; it never deletes the
clinical document. No required clinical fields are fabricated to permit
completion.

An encounter may be created from an appointment only while that appointment is
`SCHEDULED`; the caller also needs appointment-read permission. Direct creation
is separately permissioned and validates active patient, doctor, facility, and
optional branch references, staff assignment of the doctor to the location,
and the caller's location scope. After creation, those references are
immutable.

## Clinical document and validation

Clinical fields are stored separately from encounter administration metadata:

- Reason, chief complaint, history of present illness, review of systems,
  examination findings, assessment, free-text diagnoses, plan, follow-up, and
  internal notes.
- Medical history, allergies, medication history, and review of systems may be
  explicitly `UNKNOWN`, explicitly `NEGATIVE`, or `DOCUMENTED` with text.
  An absent field remains distinct from either explicit state.
- Vital measurements always include units: blood pressure in `mmHg`, heart rate
  in `bpm`, respiratory rate in `breaths/min`, temperature in `°C` or `°F`,
  oxygen saturation in `%`, height in `cm`, and weight in `kg`.
- Diagnoses are documented text only. No standardized code system is implied.

Text fields are normalized to Unicode NFKC, have line endings normalized, reject
control characters, and are limited to 8,000 characters. A clinical patch is
limited to 48 KiB; up to 20 diagnosis strings are accepted. Cancel reasons are
optional and limited to 500 characters. Vital values are finite numbers:

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

Appointment access never grants clinical access. Direct and appointment-linked
creation, listing, details, patient history, updates, lifecycle transitions,
and history each have server-side permission checks. Staff facility/branch
scope is enforced by the service and by tenant-scoped query filters. Out-of-scope
detail IDs return the same not-found response as missing records.

List responses intentionally omit clinical content. Patient-history responses
include the documented clinical record only with the dedicated history
permission. The workspace uses the existing session API and keeps clinical
content in memory only; it does not write clinical data to local or session
storage, analytics, or URL parameters. User text is HTML-escaped before
rendering.

The embedded history and central audit metadata contain the actor, timestamps,
versions, action, and changed field names—not clinical values, notes, patient
demographics, or authentication data. The central audit event identifies the
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

## Workspace and testing

The Arabic RTL workspace is available at `/encounters/` and is linked from the
appointments navigation only for users with encounter-read permission. It
supports date navigation, facility/branch/patient/provider/state filters,
appointment-linked and direct draft creation, clinical documentation, vital
sign units, explicit completion/cancellation confirmations, version-conflict
recovery, and patient history pagination.

Run unit tests with `npm test`. The disposable MongoDB/MySQL integration suite
is `npm run test:phase30`; it requires the configured local Docker socket and
never targets production. No production migration or deployment is performed
from this workspace.

Known limitations: the integration suite depends on Docker; authenticated UI
verification additionally requires an approved development database and test
user. Production MongoDB topology remains an operator decision. No automated
database provisioning, clinical amendment/reopen workflow, standardized
diagnosis coding, or regulatory-compliance claim is included.
