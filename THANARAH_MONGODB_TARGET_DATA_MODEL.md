# Thanarah — Proposed MongoDB Target Data Model

**Phase:** 59 — design only
**Status:** Proposal; not approved for implementation
**Evidence checked:** Current Prisma schema, all 36 models and 21 enums, 29 migration directories, SQL repository transaction call sites, and current tenant MongoDB storage code.

## 1. Design contract

This design carries the current application’s data and safety contracts into MongoDB. It does not select a provider, topology, region, or shard key. Every collection and index below is a logical design; physical placement must follow the approved decision record.

### Document conventions

- Keep existing UUID string IDs byte-for-byte. Map a model’s `id` to MongoDB `_id`; keep referenced IDs as the same strings.
- For SQL join models with composite primary keys and no `id`, derive a deterministic `_id` from the exact ordered key tuple (for example `membershipId + roleId`) using unambiguous encoding. Also retain the original key fields and create the unique compound index. A rerun must produce the same `_id`.
- Use BSON dates for instants, preserving millisecond precision and UTC instant meaning. `Patient.dateOfBirth` is date-only (`@db.Date`): preserve its calendar date without shifting it through a time zone.
- Preserve all other source field values one-to-one unless the field-specific rules below say otherwise. Preserve `null` versus absent where it affects source behavior. Do not let MongoDB defaults or app-only timestamps silently replace SQL values during migration.
- Add `schemaVersion` only as a migration/versioning envelope; it is not a replacement for source fields. Keep created/updated timestamps and historical event timestamps unchanged.
- Add `tenantId` to tenant-owned documents when it is not already part of their source model. Apply a trusted tenant scope to every read, update, delete, and aggregation. Never trust a request-supplied tenant ID as authorization.
- Platform-global catalogs such as `PlatformPermission` and `TenantPermission` remain platform-owned and do not receive a tenant scope. Tenant-owned roles and assignments carry `tenantId`.
- Keep audit/event history append-oriented. Updates that already exist in the source (for example security-event resolution) remain narrowly constrained and auditable.
- No TTL indexes are proposed by default. A TTL index deletes documents and is not equivalent to changing status. Add one only after an explicit retention decision and validation of legal, audit, and recovery obligations.

### Placement and tenant-storage compatibility

Keep the existing tenant-storage registry and resolver abstractions. Extend their documented design so one tenant can have multiple **explicitly registered** physical databases for distinct data domains or placements. Each route must name one authorized placement for the requested storage domain and resolve its connection reference through approved secret/configuration management. Keep database names and connection references out of caller control.

This is static placement, not automatic sharding: no automatic partitioning, cross-target fan-out, rebalancing, or record movement. Each logical collection has one authoritative placement at a time. Multiple active physical databases may serve different explicitly declared domains for one tenant, but a single request must not silently query all placements. Switching a placement is an operator-controlled migration with its own copy, reconciliation, and cutover process. Cross-database atomicity is not presumed.

## 2. Collections and per-model mapping

Unless a row says otherwise, copy source fields one-to-one, map `id` to `_id`, preserve timestamps, and validate required values before the target accepts writes. Index patterns use MongoDB field names; `unique` means a required unique index, and all patterns are tenant-prefixed where appropriate.

### Platform identity, authorization, and sessions

| Prisma model → collection | Ownership / reference strategy | Required uniqueness and query indexes | Atomicity, transfer, and retention rules |
|---|---|---|---|
| `User` → `platform_users` | Platform-global. Referenced by UUID from sessions, assignments, audit, and security documents. | Unique normalized `email` with source-equivalent case/collation behavior; `{status:1}`. | Preserve password hash, `tokenVersion`, failed-login count, lock time, and timestamps. Verify hashes with the existing verifier; never export plaintext or rehash as part of copy. Failed-login increments and lockout must use an atomic conditional single-document update. |
| `PlatformRole` → `platform_roles` | Platform-global role catalog. | Unique `code`. | Preserve IDs and role codes. Role deletion/rename policy must not invalidate assigned users unexpectedly. |
| `PlatformPermission` → `platform_permissions` | Platform-global permission catalog. | Unique `code`. | Preserve all permission definitions and seed rows. Do not rely on runtime creation to fill migration omissions. |
| `UserPlatformRole` → `platform_user_roles` | Platform assignment; reference `userId`, `roleId`. | Unique `{userId:1,roleId:1}`; reverse lookup `{roleId:1,userId:1}`. | Deterministic `_id`; validate both references. Role replacement affecting several documents requires a replica-set transaction or a reviewed single-document authorization aggregate. |
| `PlatformRolePermission` → `platform_role_permissions` | Platform assignment; reference `roleId`, `permissionId`. | Unique `{roleId:1,permissionId:1}`; reverse `{permissionId:1,roleId:1}`. | Deterministic `_id`; validate both references. Preserve permission grants exactly. |
| `PlatformSession` → `platform_sessions` | Platform-owned; reference `userId`, optional `revokedBy`. | Unique `refreshTokenHash`; `{userId:1,status:1}`, `{tokenFamilyId:1}`, `{expiresAt:1}`. | Preserve status, expiry, revocation reason/time, device and request metadata. Session creation/revocation is a conditional state transition. Do not TTL-delete without retention approval. |
| `PlatformRefreshTokenHistory` → `platform_refresh_token_history` | Platform-owned; reference `sessionId`, token family. | Unique `tokenHash`; `{sessionId:1}`, `{tokenFamilyId:1}`, `{expiresAt:1}`. | Preserve hashes, rotation/reuse timestamps. Exact separate-document rotation/reuse behavior requires a multi-document transaction on a replica set; see the decision record. Never store raw refresh tokens. |

### Tenant, membership, authorization, and staff

| Prisma model → collection | Ownership / reference strategy | Required uniqueness and query indexes | Atomicity, transfer, and retention rules |
|---|---|---|---|
| `Tenant` → `tenants` | Platform control-plane root. `_id` is tenant ID. | Unique `slug`; `{status:1}`, `{status:1,createdAt:1}`. | Preserve status transition timestamps. Tenant activation/deactivation acts as the tenant-wide authorization gate. |
| `TenantMembership` → `tenant_memberships` | Tenant-scoped; references tenant and platform user. | Unique `{tenantId:1,platformUserId:1}`, `{_id:1,tenantId:1}`, `{_id:1,tenantId:1,platformUserId:1}`; `{tenantId:1,status:1,createdAt:1}`, `{platformUserId:1,status:1}`. | Preserve membership lifecycle timestamps and status. Membership changes, owner invariants, and concurrent authorization changes need a replica-set transaction or proven atomic aggregate/conditional protocol. |
| `TenantPermission` → `tenant_permissions` | Platform-global tenant-permission catalog. | Unique `code`. | Preserve IDs, codes, descriptions, and permission seeds from SQL migrations. |
| `TenantRole` → `tenant_roles` | Tenant-scoped; references tenant. | Unique `{tenantId:1,code:1}`, `{_id:1,tenantId:1}`; `{tenantId:1,isSystemRole:1}`. | Preserve system-role status. Keep system roles protected from ordinary edit/delete paths. |
| `TenantRolePermission` → `tenant_role_permissions` | Tenant role-to-global-permission assignment. | Unique `{tenantRoleId:1,tenantPermissionId:1}`; reverse `{tenantPermissionId:1,tenantRoleId:1}`. | Deterministic `_id`; verify the role belongs to the tenant and permission exists. Replace-permissions must not leave a partially replaced set; use a replica-set transaction or versioned whole-set replacement. |
| `TenantMembershipRole` → `tenant_membership_roles` | Tenant-scoped; references membership and role with matching `tenantId`. | Unique `{membershipId:1,tenantRoleId:1}`; `{tenantId:1,tenantRoleId:1}`. | Deterministic `_id`; both referenced records must share tenant scope. Owner-role and membership-role changes need atomic concurrency control. |
| `Staff` → `staff` | Tenant-scoped; references platform user and membership. | Unique `{_id:1,tenantId:1}`, `{tenantId:1,userId:1}`, `{membershipId:1,tenantId:1,userId:1}`; `{tenantId:1,status:1,createdAt:1}`, `{userId:1,status:1}`. | Preserve user/membership linkage and lifecycle. Staff creation must confirm active tenant, membership, and user; a cross-document transaction is required unless an approved conditional protocol prevents status races. |
| `StaffRoleAssignment` → `staff_role_assignments` | Tenant-scoped; references staff and tenant role. | Unique `{staffId:1,tenantRoleId:1}`; `{tenantId:1,staffId:1}`, `{tenantId:1,tenantRoleId:1}`. | Deterministic `_id`; enforce both references belong to `tenantId`. Assign/remove authorization changes must be atomic with actor and tenant eligibility checks. |
| `StaffFacilityAssignment` → `staff_facility_assignments` | Tenant-scoped; references staff and facility. | Unique `{staffId:1,facilityId:1}`; `{staffId:1,tenantId:1}`, `{facilityId:1,tenantId:1}`. | Deterministic `_id`; facility must belong to same tenant and be eligible when assigned. Concurrency with facility deactivation requires a transaction or equivalent serialized gate. |
| `StaffBranchAssignment` → `staff_branch_assignments` | Tenant-scoped; references staff, facility, branch. | Unique `{staffId:1,branchId:1}`; `{staffId:1,tenantId:1}`, `{facilityId:1,tenantId:1}`, `{branchId:1,facilityId:1}`. | Preserve derived `facilityId`; validate branch belongs to facility and staff/facility/branch share tenant. Preserve assignment-time and status-race behavior. |

### Facilities, catalogs, doctors, and scheduling

| Prisma model → collection | Ownership / reference strategy | Required uniqueness and query indexes | Atomicity, transfer, and retention rules |
|---|---|---|---|
| `Facility` → `facilities` | Tenant-scoped; references tenant. | Unique `{_id:1,tenantId:1}`; `{tenantId:1,status:1,createdAt:1}`. | Preserve lifecycle. Branches and staff assignments reference facility by stable ID and tenant. |
| `Branch` → `branches` | Tenant derived through facility; store `tenantId` explicitly for safe scoping. | Unique `{_id:1,facilityId:1}`; `{facilityId:1,status:1,createdAt:1}`; add `{tenantId:1,status:1,createdAt:1}` for tenant-scoped access. | Preserve parent facility. Creation requires active tenant and facility; stop a branch create racing facility deactivation. |
| `Department` → `departments` | Tenant-scoped catalog. | Unique `{_id:1,tenantId:1}`, `{tenantId:1,name:1}` using source-equivalent comparison; `{tenantId:1,status:1,createdAt:1}`. | Preserve lifecycle and independent doctor assignment semantics. |
| `Specialty` → `specialties` | Tenant-scoped catalog. | Unique `{_id:1,tenantId:1}`, `{tenantId:1,name:1}` using source-equivalent comparison; `{tenantId:1,status:1,createdAt:1}`. | Department and Specialty links are independent; do not merge them or infer one from the other. |
| `Service` → `services` | Tenant-scoped catalog. | Unique `{_id:1,tenantId:1}`, `{tenantId:1,name:1}`; partial unique `{tenantId:1,code:1}` only when `code` is a string (SQL nullable unique permits multiple nulls); `{tenantId:1,createdAt:1}`, `{tenantId:1,status:1,createdAt:1}`. | Preserve nullable code, lifecycle, names and descriptions. Validate source collation before index build. |
| `Doctor` → `doctors` | Tenant-scoped; references `staff`. | Unique `{_id:1,tenantId:1}`, `{staffId:1,tenantId:1}`; partial unique `{tenantId:1,professionalCode:1}` only for non-null string; `{tenantId:1,status:1,createdAt:1}`. | Preserve professional fields and lifecycle. Keep Department and Specialty assignment collections separate. |
| `DoctorDepartmentAssignment` → `doctor_department_assignments` | Tenant-scoped; references doctor and department. | Unique `{doctorId:1,departmentId:1}`; `{doctorId:1,tenantId:1}`, `{departmentId:1,tenantId:1}`. | Deterministic `_id`; validate both records share tenant. Assignment writes lock/check active tenant, doctor, and catalog. |
| `DoctorSpecialtyAssignment` → `doctor_specialty_assignments` | Tenant-scoped; references doctor and specialty. | Unique `{doctorId:1,specialtyId:1}`; `{doctorId:1,tenantId:1}`, `{specialtyId:1,tenantId:1}`. | Deterministic `_id`; independent of department assignments. Use same active-state and tenant validation rules. |
| `FacilitySchedulingPolicy` → `facility_scheduling_policies` | Tenant-scoped; one current policy per facility. | Unique `{facilityId:1,tenantId:1}`, `{_id:1,tenantId:1}`; `{tenantId:1,status:1}`. | Preserve timezone, JSON rules, status, and integer version. Update with `version` compare-and-set; revision consistency requires a replica-set transaction or a reviewed append-only/event projection design. |
| `FacilitySchedulingPolicyRevision` → `facility_scheduling_policy_revisions` | Tenant-scoped immutable revision; references policy/facility/actor. | Unique `{policyId:1,version:1}`; `{tenantId:1,facilityId:1,createdAt:1}`. | Preserve full policy snapshot, action, actor, and revision time. Never rewrite older revisions during migration or normal edits. |

### Commercial, storage registry, and legacy patient data

| Prisma model → collection | Ownership / reference strategy | Required uniqueness and query indexes | Atomicity, transfer, and retention rules |
|---|---|---|---|
| `Plan` → `plans` | Platform-global commercial catalog. | Unique `key`; `{status:1,createdAt:1}`. | Preserve lifecycle and plan IDs. |
| `Feature` → `features` | Platform-global feature catalog. | Unique `key`; `{status:1,createdAt:1}`. | Preserve lifecycle and feature IDs. |
| `PlanFeature` → `plan_features` | Platform plan-to-feature association. | Unique `{planId:1,featureId:1}`; `{featureId:1,createdAt:1}`. | Deterministic `_id`; preserve enabled flag, quota JSON and timestamps; validate both catalog references. |
| `Subscription` → `subscriptions` | Platform-owned; references tenant and plan. | `{tenantId:1,status:1,startsAt:1,endsAt:1}`, `{planId:1,createdAt:1}`. | Preserve lifecycle and interval values. MongoDB unique indexes cannot by themselves prevent overlapping time intervals. Serialize per tenant with a transaction on a replica set or a proven tenant-version/lease protocol. |
| `TenantStorageTarget` → `tenant_storage_targets` | Platform control plane; references tenant and a safe connection-reference alias. | Unique `{connectionReference:1,databaseName:1}`; `{tenantId:1,status:1,isPrimary:1,createdAt:1}`, `{provider:1,status:1}`. | Preserve inactive/active/primary states. Never store URI credentials. Registration creates inactive/non-primary targets; activation verifies exact indexes before state change; primary switching must be atomic at the registry level. |
| SQL `Patient` → reconcile into tenant `patients` | Legacy SQL source; active runtime is tenant MongoDB. Target is the authoritative tenant’s existing `patients` collection, not a new platform-wide patient collection. | Preserve current tenant Patient indexes: unique `{_tenantId:1,patientNumber:1}`; tenant/status/created and tenant/created list indexes; three partial unique duplicate-identity indexes with existing collation, after exact topology compatibility review. | First report source/target matches and conflicts. Keep both copies until a signed disposition. Match stable tenant and Patient IDs before secondary identity; never auto-merge or delete. Preserve date-only DOB. |

### Audit, security, and encounter operations

| Prisma model → collection | Ownership / reference strategy | Required uniqueness and query indexes | Atomicity, transfer, and retention rules |
|---|---|---|---|
| `PlatformAuditLog` → `platform_audit_logs` | Platform audit record; optional user, tenant, and session references use stable IDs and may become dangling only under existing SetNull semantics. | `{eventType:1,occurredAt:1}`, `{actorUserId:1,occurredAt:1}`, `{subjectUserId:1,occurredAt:1}`, `{subjectTenantId:1,occurredAt:1}`, `{sessionId:1,occurredAt:1}`; consider unique `eventId` only after checking actual event idempotency contract. | Preserve all event IDs, metadata, IP/user-agent and time. Append-only by policy. Define access, retention and export controls; do not assume Mongo immutability without enforcement. |
| `PlatformSecurityEvent` → `platform_security_events` | Platform security record; optional actor/subject/resolver references. | `{eventType:1,status:1,occurredAt:1}`, `{actorUserId:1,occurredAt:1}`, `{subjectUserId:1,occurredAt:1}`, `{sessionId:1,occurredAt:1}`. | Preserve open/resolved state, resolution note, timestamps and actor identity. Resolve through conditional `status:'OPEN'` update; retain under approved policy. |
| `EncounterOperation` → `encounter_operations` or tenant-local durable outbox | Must be co-located with the encounter mutation boundary where possible; if kept platform-global, explicit saga/outbox is required. | Unique `_id` (source operation ID) and `historyEventId`; `{tenantId:1,auditDeliveryStatus:1,createdAt:1}`, `{auditDeliveryStatus:1,createdAt:1}`. | Preserve every state, metadata, attempt count, expected version, classification, and idempotency field. Required before clinical writes; reconciliation and audit delivery must be idempotent. Cross-cluster atomicity is not assumed. |

### Existing tenant MongoDB document models

Keep the existing domain collections and current API contracts. Preserve their current tenant-prefixed indexes and trusted context filters. New fields or subcollections need a separate compatibility review.

| Collection | Document ownership and references | Existing operational indexes / validation | Migration and atomicity rules |
|---|---|---|---|
| `patients` | One tenant’s Patient documents; `_tenantId` is enforced on reads and writes; appointment and encounter references use stable Patient IDs. | Unique tenant+patient number; tenant/status/created and tenant/created list indexes; duplicate indexes for normalized name+phone, name+email, and name+date-of-birth. Required index definitions are preflighted before relevant writes. | If retaining target DB, reconcile/index-check without copying. If moving DB, copy with stable IDs, build indexes after conflict report, verify exact key order/options/collation, then activate target. |
| `appointments` | Tenant-owned; references patient, doctor, facility, branch, service and creator/updater IDs. | Preserve tenant-prefixed doctor/status/time, startsAt, status/startsAt, facility, branch, patient, and service query indexes as currently defined. Keep optimistic version. | Single appointment changes use conditional versioned updates. Patient reference checks and schedule lock interactions must preserve current failure handling. |
| `encounters` | Tenant-owned clinical aggregate; references patient, appointment, doctor, facility and branch. Clinical content, diagnoses, service records and amendments currently share an encounter document; metadata history must not contain clinical values. | Preserve tenant-scoped indexes for encounter ID, appointment, patient/time, doctor/time, facility/time, facility+branch/time, and status/time. | Preserve versioned conditional writes and clinical data. Review document growth and MongoDB document-size limits; if history/amendments are split, that is an explicit architecture change requiring transaction/outbox proof. |
| `appointment_schedule_locks` | Tenant/resource lock record, keyed by resource type/id and owner token. | Unique `{_tenantId:1,resourceType:1,resourceId:1}`. Current code explicitly releases; no lease/TTL is established. | Retain lock ordering and owner-token conditional release. Any lease expiry, TTL, or stale-lock repair is a separate behavior decision. |

## 3. SQL relational constraints translated to MongoDB

For every SQL relation:

1. Preserve referenced IDs and add the appropriate tenant key to the child where needed.
2. Validate target existence and tenant agreement in the service method that writes the reference. A query must include both stable ID and tenant scope.
3. Use a unique index for uniqueness that can be expressed by key; use partial indexes for nullable unique fields where SQL permits multiple nulls.
4. For multi-document changes that must succeed or fail together, use a transaction on a transaction-capable replica set or redesign the aggregate/protocol and prove equivalent behavior. An application-level “check then insert” without a unique index is not safe under races.
5. Model SQL `ON DELETE RESTRICT` as prohibited deletion while references exist, with a guarded delete workflow. Model `SET NULL` only where the source explicitly allows it; update dependent documents under a safe deletion workflow.
6. Do not encode security-sensitive membership or resource scope solely in a cached role array if the source checks current membership/user/facility/branch status.

## 4. Enum and validation mapping

The 21 SQL enums are application contracts, not MongoDB schema constraints. Preserve their stored string values and validate on every write, import, and relevant read. This includes identity/status enums, tenant/storage/catalog status, plans/subscriptions/features, audit/security event types/status, scheduling policy status/action, and encounter-operation state/status. During transfer, quarantine invalid values for owner disposition; do not coerce unknown values to a default.

