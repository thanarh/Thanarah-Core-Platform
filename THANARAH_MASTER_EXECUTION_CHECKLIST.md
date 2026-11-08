# Thanarah Master Product Completion Roadmap

**Updated:** 2026-11-08
**Overall release status:** NOT READY — product, security, and operational acceptance remain open.
**Production status:** No production database, configuration, migration, deployment, or payment was accessed or changed.

This is the single current status and acceptance register for Thanarah completion. It replaces the former MongoDB-migration-only checklist as the live roadmap; detailed phase reports remain historical evidence. Update this file after each accepted stage rather than creating competing master checklists.

## 1. Product and safety decisions

- **Keep the hybrid architecture.** Central identity, authentication, authorization, tenant and membership metadata, SaaS plans/subscriptions, registry metadata, and platform audit remain MySQL/Prisma. Tenant clinical and operational data use the existing MongoDB storage boundary. A wholesale MySQL-to-MongoDB migration is not a product-completion goal and is not authorized.
- **Keep tenant boundaries fail-closed.** Never weaken authentication, authorization, trusted tenant context, facility/branch scope, or storage readiness to make a workflow appear complete.
- **No production operations in this program.** Use synthetic data and approved non-production systems only. Do not read or reveal secret values, use production data, deploy, apply production migrations, or make live payments.
- **Keep payments last.** Geidea is the selected payment provider. Its separate final stage is gated on the rest of the program and final acceptance; production processing still requires separate explicit approval.
- **Do not invent commercial or legal rules.** Clinic invoices and SaaS subscriptions are separate. SAR may be the configurable default requested by the owner; tax rates, legal invoice fields, pricing, refunds, and invoice numbering need approved rules.
- **Do not create a parallel mobile app.** No Flutter/mobile project manifest was found in the repository scan. If deeper inspection confirms no existing app, request a platform/stack decision before creating one.
- **Keep AI separate from clinical business logic.** AI tools may call only authorized Thanarah services; no unrestricted database access, arbitrary queries, or unapproved transfer of patient data to external providers.

## 2. Evidence rules

| Label | Meaning |
|---|---|
| **Implemented and tested** | Code and a relevant recorded test or authenticated workflow exist. This does not imply production readiness. |
| **Implemented, partial evidence** | Code exists, but important failure, browser, operational, or release paths remain unverified. |
| **Not implemented in this repository** | No adequate implementation was found in the inspected repository; this does not rule out an external system. |
| **Blocked** | An owner decision, approved environment, provider, policy, or credential is required. |
| **Queued** | A project task exists but its predecessor is not yet complete. |
| **Draft proposal** | A follow-up is visible in the project task list but has not been accepted or implemented. |

Do not promote a feature to “implemented and tested” based only on a page, API, mock, test source, or historical report. Record the environment, test scope, and limitation with each acceptance result.

## 3. Current evidence-based inventory

| Area | Current status | Evidence and limits |
|---|---|---|
| Platform identity, login, sessions, roles and authorization | **Implemented and tested; production release gate open** | Auth, session lifecycle, platform permissions, tenant membership checks, and tenant authorization have focused unit/HTTP/integration coverage. This is not an independent penetration test or production deployment certification. |
| Tenant administration and existing-account membership lifecycle | **Implemented for available APIs and tested browser flows** | Tenant and membership workspaces cover existing platform accounts and lifecycle operations. New platform-user registration and invitation email delivery are not implemented. Owner transfer/removal remains constrained by current policy. |
| Facilities, branches, team and clinic setup | **Implemented in part; end-to-end release coverage remains open** | Facility/branch and staff/scope APIs and selected browser flows exist. Use task #84 to reconcile remaining clinic workflows; do not duplicate tasks #73 and #74. |
| Departments, specialties, doctors, services | **Implemented and browser-tested for current CRUD/lifecycle scope** | Authenticated catalog and doctor setup flows cover tested create/edit/status operations and tenant boundaries. |
| Doctor-to-service assignments | **Implemented in the current repository; scoped tests exist** | API and UI support facility/branch-scoped add/remove operations, and appointment validation can require an assignment. Earlier statements in `THANARAH_PRODUCT_COMPLETION_ROADMAP.md` that this capability is absent are stale. The consolidated review screen is separately proposed in task #81. |
| Patients | **Core workflow implemented and tested** | Directory, registration/edit, search, lifecycle, tenant storage safeguards, duplicate protection, and authenticated browser evidence exist. Accessibility, broader browser coverage, and rollout acceptance remain. |
| Appointments and scheduling | **Core staff workflow implemented and tested** | Booking, updates, rescheduling/cancellation, facility policy/timezone and conflict controls exist. Public booking is not present. Filtering eligible services in the booking UI remains in draft task #80. |
| Encounters and clinical records | **Implemented for documented scope; operational review gaps remain** | Encounter notes, vitals, diagnoses, service records, lifecycle, history, and recovery contracts exist. Prescriptions, orders, referrals, claims, and standardized diagnosis coding are not established as implemented. |
| SaaS plan/subscription foundations | **Backend implemented; commercial billing absent** | Plan, feature, subscription lifecycle, entitlement, and quota-definition foundations exist. There is no automated collection, renewal charging, authoritative usage metering, or payment reconciliation. |
| Clinic invoices and financial operations | **Not implemented in this repository** | No invoice, accounting ledger, clinic payment, refund, or financial reporting workflow was found. Business and legal rules must be approved before enforcement. |
| Responsive bilingual web product | **Partially implemented** | Arabic/RTL static workspaces and authenticated browser coverage exist for selected journeys. Full English coverage, accessibility, responsive/device matrix, and consistent loading/error/empty states are not yet accepted. |
| Mobile application | **Not found in this repository scan** | No Flutter `pubspec.yaml` or mobile project manifest was found. Do not create a parallel application without an explicit platform/stack decision. |
| AI platform and RAG | **Not implemented in this repository** | `replit.md` documents a future voice receptionist direction only. No model registry, AI service, agent administration, RAG, vector store, or AI dashboard was found. |
| WhatsApp, SMS, voice and workflow automation | **Not implemented in this repository** | No live provider or channel integration was evidenced. Provider choice, consent, message retention, call handling, and delivery operations require decisions and verified credentials. |
| Security and dependencies | **Implemented baseline; current release assessment required** | Authentication and tenant-scope controls have tests; staging/production CORS fails closed for untrusted origins. The Phase 51 security report is historical: it records unresolved audit findings and no production/staging origin allowlist. Re-run current scans before claiming readiness. |
| Storage, database and recovery operations | **Partially implemented; production readiness blocked** | The application uses MySQL/Prisma centrally and MongoDB behind tenant storage. Mongo provider/topology, TLS/network controls, transaction guarantees, backup/restore, residency, ownership, and RPO/RTO remain unapproved or unverified. Phase 61/62 replica-set backup/restore was not run. |

## 4. Ordered execution and acceptance register

The task queue enforces this order. Each completed stage must add its evidence and date to Section 7 before work advances.

| Stage | Area | Task | Status at update | Acceptance evidence |
|---|---|---:|---|---|
| A | Evidence inventory and master register | #82 | **Complete for this documentation stage** | This file reflects current code, historical evidence limits, existing proposals, blockers, and the A–J acceptance order. |
| B | Security and operational readiness | #83 | **Queued** | Current security/dependency scans; auth and tenant-scope tests; safe non-production recovery/operations evidence where an approved environment exists; explicit unresolved blockers. No production readiness claim without approvals. |
| C | Clinic and clinical workflows | #84 | **Queued** | Authorized synthetic tenant completes required setup and patient-to-appointment-to-encounter flows; API and browser tests verify permissions, tenant/facility/branch scope, failure states, and persistence. Existing proposals #73, #74, #80, and #81 remain separate and must not be duplicated. |
| D | Web experience and responsive behavior | #85 | **Queued** | Approved workflows work in Arabic RTL and English LTR across supported phone/desktop sizes, with accessible loading, empty, success, error, and permission-denied states; authenticated browser evidence is recorded. |
| E | Clinic finance foundation | #86 | **Queued** | Configurable invoice lifecycle and audit behavior are tested with approved fields and policies; clinic invoices remain distinct from platform SaaS subscriptions; no payment collection is enabled. |
| F | Mobile readiness | #87 | **Queued; app existence/target unresolved** | Existing mobile app is completed if found. If none exists, record the missing target and obtain approval before creating a new app or selecting a framework. No store release or production signing. |
| G | Thanarah AI platform | #88 | **Queued** | Isolated AI service/control plane, tenant permissions, provider abstraction, RAG and tool boundaries are tested with synthetic content; AI reaches business actions only through authorized Thanarah services. |
| H | Channels and automation | #89 | **Queued** | Official provider adapters, consent/opt-out, signed webhooks, idempotency, delivery/retry audit, and tenant isolation pass simulated tests. Live sending/calling stays off without approval and credentials. |
| I | Final product acceptance | #90 | **Queued** | Full agreed test matrix and screen-to-API journeys pass; limitations, blocked checks, security and recovery evidence are recorded; no production deployment is implied. |
| J | Geidea payment integration | #91 | **Queued — final stage only** | Starts only after Stage I. Sandbox lifecycle, signatures, idempotency, reconciliation and refund simulations pass; production charges remain disabled pending separate approval. |

### Existing separate draft proposals

These are already in the task list and are not recreated by this roadmap:

| Task | Draft outcome |
|---:|---|
| #73 | Search/select existing platform accounts when inviting a member. |
| #74 | Hide platform management actions from users without permission while keeping server authorization authoritative. |
| #80 | Filter booking services by doctor, facility and branch. |
| #81 | Review doctor/service assignments from a consolidated screen. |

## 5. Architecture and release gates

### Persistence boundary

- Central identity, authentication, sessions, permissions, tenant/membership metadata, SaaS catalog/subscriptions, storage registry, and platform audit remain on MySQL/MariaDB with Prisma.
- Tenant clinical/operational data uses the established MongoDB storage boundary. Do not move central platform records to MongoDB or activate an adapter based on port coverage alone.
- Keep clients from selecting physical database names or connection strings. No cross-tenant fallback, dual writes, or weakening of storage readiness.
- `PHASE_60_MIGRATION_READINESS_DECISIONS.md` records no-go conditions for a broad Mongo migration; `THANARAH_MONGODB_MIGRATION_DECISIONS.md` and `TENANT_MONGODB_DEPLOYMENT_DECISION.md` contain the detailed historical decisions and open questions.

### Security and operations

- Phase 51 recorded historical audit totals of 4 high and 2 moderate production-tree findings, and 2 critical, 4 high, and 4 moderate in the full npm tree; Replit's dependency audit reported different totals. These are not current scan results and must not be combined.
- CORS intentionally rejects untrusted staging/production origins; a narrow allowlist has not been established in the cited report.
- The latest documented development database diagnostic classified the configured URL as non-MySQL without reading or displaying its value. Live MySQL-backed checks remain blocked until safe development configuration is corrected.
- No approved MongoDB production provider/topology or transaction profile is documented. TLS/certificate validation, network access, shard policy, residency, and operating owner still require evidence.
- Phase 61 and Phase 62 did not create or restore a backup because an approved isolated replica-set source and separate restore target were unavailable. RPO/RTO and restore timing are therefore not measured.
- A test pass or local `/health` response does not prove production readiness. `/ready` and any database-dependent verification must be reported separately.

### Commercial, AI, and communications boundaries

- Separate clinic invoices from platform SaaS subscription assignment. Do not infer tax, pricing, legal invoice wording, refund, cancellation, or payment rules.
- SAR is a configurable default requested by the owner, not a hard-coded legal conclusion.
- Treat AI providers, embeddings, model hosting, vector storage, external telemetry, WhatsApp, and voice providers as unselected until documented. Use approved secret handling; never print credentials.
- Do not put protected health information into external model calls, analytics, or test fixtures without explicit approval and an appropriate privacy/security review.
- Geidea sandbox work is last; production processing requires another explicit authorization.

## 6. Repository and workflow state

- The branch observed for this update is `main`; the available branch list contained no `develop` branch. Do not switch or create a branch implicitly. The requested development-branch workflow must be reconciled before subsequent code tasks.
- The worktree was clean immediately before this document update. Existing code and committed work were not reset, stashed, or rewritten.
- This task changes documentation only. It does not run migrations, alter application behavior, inspect secret values, or change database configuration.

## 7. Acceptance log

| Date | Stage | Result and evidence | Limits / next gate |
|---|---|---|---|
| 2026-11-08 | A — Inventory and master register | Reviewed current source, `replit.md`, README, product roadmap, MongoDB decisions, Phase 51/60/61/62 reports, task queue, branch list, and code/test references for doctor-service assignments. Replaced this file's MongoDB-only checklist with the current A–J product roadmap and acceptance register. | Documentation review only; no tests were rerun for this task. Previously recorded verification after the doctor-service assignment work: 966 tests passed, 33 skipped; Phase 30 integration suite 39/39; build, type-check, formatting, and Prisma validation passed; lint had one existing warning. These are prior results, not validation of the present documentation edit. No production data or secrets were accessed. |

### Next evidence to record

For every later stage, append a dated row with: scope changed, tests actually run and counts, browser/device/locale coverage, database/provider used (never secret values), known skips/failures, production boundary, and explicit acceptance or blocking reason. Do not copy results from a prior report as if they were rerun.

## 8. Source reports retained

These documents remain detailed evidence, not competing live roadmaps:

- `THANARAH_PRODUCT_COMPLETION_ROADMAP.md`
- `THANARAH_REMAINING_BLOCKERS.md`
- `THANARAH_MONGODB_MIGRATION_DECISIONS.md`
- `TENANT_MONGODB_DEPLOYMENT_DECISION.md`
- `PHASE_51_SECURITY_HARDENING_REPORT.md`
- `PHASE_60_MIGRATION_READINESS_DECISIONS.md`
- `PHASE_61_BACKUP_RESTORE_TEST_REPORT.md`
- `PHASE_62_BACKUP_RESTORE_RESULTS.md`
