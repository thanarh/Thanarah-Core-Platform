# Provider-neutral tenant-storage recovery specification

**Status:** Operational requirements remain open. Phase 49 added a disposable artifact prototype and passed a disposable restore test; this is not production backup automation or evidence that production backups exist.

## Scope and current evidence

The application stores central identity, membership, authorization, and tenant-storage routing metadata in MySQL/MariaDB. Patient, appointment, and encounter records are routed to tenant-owned physical databases through the tenant-storage registry. The MongoDB provider/topology is still pending approval.

Phases 47–48 found no in-repository backup automation, restore tooling, or verified restoration runbook. Phase 49 added encrypted, signed recovery artifacts and verified a restore using disposable MySQL 8.0.41 and MongoDB 7.0.17 containers. The tested restore covered the central database and both registered tenant fixtures; it does not establish production recoverability. Do not infer provider-managed backups or successful production recovery. No production system has been accessed.

## Required recovery design

1. **Central database coverage**
   - Back up the complete platform database, including tenant routing registry, users/sessions, memberships/permissions, migration state, audit records, and operation ledgers.
   - Capture a consistent point in time and the corresponding schema/migration version.

2. **Tenant-data coverage**
   - Discover the authoritative inventory of registered physical tenant databases from the protected control plane.
   - Cover every active tenant database and explicitly define treatment of inactive, archived, or transitioning targets.
   - Preserve the mapping between each tenant, target, provider, connection reference, database name, and backup timestamp in protected backup metadata.
   - Do not enumerate tenant identifiers or records through public health endpoints.

3. **Protection and retention**
   - Encrypt backups in transit and at rest; store keys separately from backup artifacts.
   - Restrict backup creation, listing, restore, and deletion to named operational roles with auditable access.
   - Keep at least one protected copy outside the primary failure domain.
   - Obtain owner-approved retention, legal-hold, and secure deletion requirements before setting durations.

4. **Consistency and restore**
   - Define a coordinated snapshot or write-quiescence method for central metadata and tenant databases, including active mutations and migration cutovers.
   - Restore into an isolated disposable environment; never test by overwriting production.
   - Validate schema/index readiness, tenant-to-target mappings, counts and integrity checks selected by the data owner, and representative authenticated reads/writes using synthetic or approved test data.
   - Record start/end times, validation outcomes, exceptions, and operator approvals. A backup is not proven recoverable until a restore succeeds.

5. **Objectives and alerting**
   - Product, Security, and Operations owners must approve RPO, RTO, retention, and acceptable recovery-point consistency; this specification assigns no values.
   - Alert on missed/failed backups, incomplete tenant coverage, integrity-check failures, and restore-test failures. Alerts must reach an owned on-call process.
   - Assign an accountable operator for backup inventory, key custody, recovery authorization, and evidence retention.

## Safe implementation gate

The Phase 49 prototype is intentionally not a production backup service: it does not schedule backups, store artifacts outside the temporary filesystem, manage production keys, authorize operators, alert, set retention, or define recovery objectives. The integration test uses a MySQL single-transaction dump and separately captured MongoDB data; cross-store atomicity is not guaranteed.

Do not build provider-specific backup automation until the provider/topology, available backup primitives, data residency, healthcare agreement, consistency model, and recovery objectives are approved. After approval, implement and rehearse the plan only against disposable infrastructure before production use.
