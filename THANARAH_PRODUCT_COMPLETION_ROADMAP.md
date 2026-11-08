# Thanarah Product Inventory and Completion Roadmap

**Assessment basis:** current repository, documentation, available automated tests, and Phase 47–54 reports.
**Purpose:** evidence-based inventory and proposed release sequencing. This is not an owner-approved product specification, regulatory assessment, production certification, or claim that features outside the evidence are complete.

## 1. Executive summary

The repository contains a substantial healthcare SaaS backend: platform authentication and authorization, tenant memberships and role management, facilities and staff scoping, catalogs, patient APIs, appointment scheduling, medical encounters, SaaS plan/subscription foundations, and storage/readiness controls. API and database behavior is supported by unit, HTTP, and disposable MySQL/MongoDB tests.

The usable frontend is much narrower than the backend. It consists of a public “coming soon” landing page and static Arabic/RTL appointment, encounter, patient, clinic setup, team setup, catalog, and doctor workspaces. The appointment, encounter, patient-management, facility/branch, selected membership/staff/scope, and authenticated catalog/doctor workflows have browser-flow evidence. Tenant provisioning and lifecycle, SaaS administration, billing, and a patient-facing portal remain incomplete or out of scope.

The product cannot be represented as ready for a controlled commercial deployment yet. Phase 50 and Phase 51 document unresolved tenant-storage provider/topology and recovery decisions, missing production recovery operations, dependency advisories, incomplete production deployment evidence, and the newly hardened CORS policy requiring explicit trusted origins for cross-origin production clients.

The proposed first release below concentrates on the existing clinic workflows and required operational foundations. It must be approved by the product owner. In particular, the repository does not establish whether invoicing, insurance, patient communications, patient self-service, or payment collection are mandatory for the initial commercial release.

## 2. Classification key and evidence limits

- **Complete and verified:** implemented and supported by relevant tests or verified workflow evidence.
- **Implemented, partially verified:** code exists, but important operational, failure, or end-to-end paths remain unverified.
- **Partially implemented:** some, but not all, of the capability is present.
- **Backend only:** APIs/services exist, but a complete usable frontend workflow was not found or verified.
- **Frontend only or disconnected:** UI exists without a complete backend integration.
- **Not implemented:** no adequate implementation evidence was found in the inspected repository.
- **Blocked by external decision:** depends on owner, provider, policy, credential, or infrastructure approval.
- **Optional / deferred:** documented as future or not established as initial-release scope.

“Not implemented” means no adequate evidence was found in this repository; it does not assert that no external system or business process exists.

## 3. Evidence-based feature inventory

### Platform, identity, tenancy, and SaaS

| Capability | Status | Repository evidence and notes |
|---|---|---|
| Platform login, password verification, access tokens, refresh rotation, sessions, logout and logout-all | **Complete and verified** | `src/auth/auth.controller.ts`, `src/auth/services/`, `src/auth/guards/platform-auth.guard.ts`; `test/auth-foundation.spec.ts`, `test/auth.e2e.spec.ts`, `test/auth-throttle.e2e.spec.ts`, `test/platform-session.repository.spec.ts`; authenticated disposable browser flow in `test/phase30-patient.integration.spec.ts`. |
| Platform roles and permissions | **Complete and verified** | `src/auth/platform-authorization*`, `src/platform-security/`; Prisma models `PlatformRole`, `PlatformPermission`, `UserPlatformRole`, `PlatformRolePermission`; `test/platform-authorization.spec.ts`, `test/platform-authorization.e2e.spec.ts`. |
| Tenant organizations and lifecycle | **Implemented and authenticated-browser verified for available APIs** | `src/tenant/tenant.controller.ts`, `tenant.service.ts`, `tenant.repository.ts`, and the `/platform-setup/` workspace; Prisma `Tenant`; unit/HTTP and disposable authenticated Chromium coverage verify create, browse, suspend, and reactivate. |
| Tenant memberships and lifecycle | **Implemented and authenticated-browser verified for existing platform accounts** | `src/tenant/tenant-membership.controller.ts`, membership services/repositories, and `/platform-setup/`; Prisma `TenantMembership`; authenticated Chromium coverage verifies invite, activate, suspend, reactivate, remove, permission denial, and tenant-scoped listing. Creating platform users and sending email invitations remain unavailable. |
| Tenant roles, permission assignments, initial-owner bootstrap | **Existing-role assignments verified in the team UI; role-definition and bootstrap APIs remain backend-only** | `/team-setup/` assigns and removes existing tenant roles for memberships and staff. `src/tenant/tenant-role.controller.ts`, `tenant-role-bootstrap.controller.ts`, authorization/context guards, `test/tenant-role.e2e.spec.ts`, and `tenant-authorization.spec.ts` cover backend role definitions, permission bundles, and bootstrap. Owner-transfer/removal constraints remain policy-limited. |
| Facilities, branches, staff, staff roles and facility/branch scope | **Implemented and authenticated-browser verified for synthetic workflows** | `/clinic-setup/` manages facility/branch lifecycle; `/team-setup/` manages staff profiles, existing role assignments, and facility/branch scope. The disposable browser journey verifies persisted setup and permission-denied behavior; `test/workspace-ui-tenant-isolation.spec.ts` covers delayed responses across workspace switches. API enforcement remains authoritative. |
| Department, specialty, doctor, service catalogs and doctor assignments | **Implemented and authenticated-browser verified for current scope** | Existing APIs remain under `src/tenant/tenant-healthcare-catalog.controller.ts`, `doctor.controller.ts`, and `tenant-service-catalog.controller.ts`. Authenticated `/catalog-setup/` and `/doctor-setup/` flows cover catalog/doctor lifecycle, department/specialty links, and facility/branch-scoped doctor-service add/remove. The consolidated cross-doctor assignment review remains separate in proposal #81. |
| Plans and Features catalog administration | **Backend only** | `src/platform-catalog/plan.controller.ts`, `feature.controller.ts`, services and repositories; `test/saas-catalog.e2e.spec.ts`, migration and service tests. README explicitly states that plan/feature metadata does not implement pricing, payment, trial, renewal, or usage metering. |
| Subscription assignment and lifecycle administration | **Backend only** | `src/subscriptions/subscription.controller.ts`, service/repository/rules; Prisma `Subscription`; `test/subscription.e2e.spec.ts`, service/repository/rules tests. This is subscription-state administration, not a payment processor or automated recurring billing system. |
| Entitlement and quota definitions/decision services | **Partially implemented** | `src/tenant/tenant-entitlement.*`, `tenant-quota.*`, `src/platform-catalog/plan-feature-quota.ts`; tests under `test/tenant-entitlement*`, `tenant-quota*`, `plan-feature-quota.spec.ts`. README states that no existing business route is gated by entitlement and quota definitions are not usage counters. |
| Tenant storage registry, trusted target resolution, activation/index preflight | **Implemented, partially verified** | `src/tenant/tenant-storage.*`, `tenant-mongo-client.manager.ts`, Mongo patient/appointment/encounter adapters; Prisma `TenantStorageTarget`; disposable storage and integration tests. The production provider/topology is still pending owner approval; see Sections 6–7. |
| Platform audit/security events and encounter operation ledger/reconciliation | **Implemented, partially verified** | `src/platform-security/`, `src/tenant/tenant-encounter.controller.ts`; Prisma `PlatformAuditLog`, `PlatformSecurityEvent`, `EncounterOperation`; tests `test/platform-security.spec.ts`, `test/encounter-operation-reconciliation.spec.ts`, integration tests. Audit persistence outside the encounter ledger has documented best-effort/cross-store limitations; no support/operations review console was found. |

### Healthcare operations

| Capability | Status | Repository evidence and notes |
|---|---|---|
| Patient create/read/update/lifecycle and tenant directory search | **Complete and verified for core workflow** | `src/tenant/tenant-patient.controller.ts`, patient service/repository/storage and duplicate protection; `public/patients/` provides the Arabic/RTL directory, profile, registration/edit, search, and lifecycle actions through existing APIs. Authenticated Chromium acceptance covers create/search/profile/edit/deactivate/reactivate and reload persistence; disposable MongoDB tests cover tenant isolation, duplicates, indexes, and concurrent writes. Broader accessibility, browser-matrix, and rollout acceptance remain. |
| Appointment booking, list/search, update, reschedule, cancel, scheduling policies, timezone and conflict controls | **Complete and verified for implemented scope** | `src/tenant/tenant-appointment.controller.ts`, `appointment.service.ts`, storage adapters and facility scheduling policy; `docs/tenant-appointments.md`; `public/appointments/`; tests `test/tenant-appointment.e2e.spec.ts`, service/policy tests and the disposable real-database/browser suite. Scope is tenant-authenticated clinic staff; no public self-booking workflow was found. |
| Reception appointment workspace | **Complete and verified for tested workflows** | `public/appointments/index.html`, `app.js`, `api.js`, `timezone.js`; permission-aware workspace selection, appointment filters/actions and patient/doctor/facility/branch data loading; authenticated Chromium flow in `test/phase30-patient.integration.spec.ts`. Full rollout usability, accessibility review, localization review, and non-Chromium/browser coverage were not established. |
| Medical encounters, clinical notes, vitals, structured diagnoses, service/procedure records, completion/cancellation, history and reasoned amendments | **Complete and verified for implemented scope** | `src/tenant/tenant-encounter.controller.ts`, encounter service/storage/repository; `docs/tenant-medical-encounters.md`; `public/encounters/`; `test/encounter.service.spec.ts`, operation reconciliation tests, disposable integration and signed-in browser journey. The documented scope intentionally excludes prescriptions, orders, referrals, claims, billing, and standardized diagnosis coding. |
| Encounter audit delivery/recovery | **Implemented, partially verified** | `EncounterOperation` ledger and reconciliation API documented in `docs/tenant-medical-encounters.md`; Phase 46 integration evidence in `test/phase30-patient.integration.spec.ts`. Recovery is evidence-based and does not replay clinical writes, but documented failure windows and missing operator review UI remain. |
| Prescriptions, medication ordering/dispensing, and pharmacy workflow | **Not implemented** | `docs/tenant-medical-encounters.md` explicitly says prescriptions and orders are not added. No corresponding prescription/order module or API was located. Product priority is unconfirmed. |
| Clinical documents, attachments, referrals, and document-generation workflow | **Not implemented** | No clinical document/referral module, API, storage workflow, or corresponding Prisma model was located in `src/` or `prisma/schema.prisma`. Whether required for release is unresolved. |
| Insurance eligibility, claims, adjudication, and reconciliation | **Not implemented** | No relevant controller/module/model was located; the encounter guide explicitly excludes claims. No insurer or clearinghouse provider is selected. |
| Patient communications, reminders, WhatsApp, SMS, and notification preferences | **Not implemented** | No notification module, provider integration, message model, or delivery workflow was located. Channel, consent, language, retention, and provider decisions remain unresolved. |
| Patient portal or patient mobile application | **Not implemented in this repository** | `public/` contains staff appointment and encounter workspaces, not a patient-facing portal. No patient authentication/account or mobile artifact was found. Product need is unresolved. |

### Commercial, analytics, and platform services

| Capability | Status | Repository evidence and notes |
|---|---|---|
| Invoices, payment collection, refunds, accounting, and clinic financial reports | **Not implemented** | No invoice, payment, refund, ledger, accounting, or gateway module/model/API was found. Pricing, tax, invoice requirements, payment provider, and refund rules must not be inferred. |
| SaaS subscription payments, automated billing, renewals, dunning, upgrades/downgrades | **Partially implemented** | SaaS plan/feature/subscription records and subscription lifecycle APIs exist; payment authorization, invoicing, renewal charging, dunning, and provider reconciliation were not found. This is a separate product decision from clinic invoicing. |
| CRM, leads, campaigns, marketing automation | **Not implemented** | No adequate implementation evidence found. No initial-release requirement located. |
| Clinic website builder, domain management, online booking | **Not implemented** | Public root page is a “coming soon” landing page (`public/index.html`); no website-builder, tenant-site, domain, or public booking API/workflow was found. |
| Analytics and operational dashboards/reports | **Not implemented** | No analytics/reporting module or dashboard workflow was found. The existing API and audit metadata are not by themselves a reporting product. |
| Health and readiness endpoints, API documentation | **Backend only** | `src/app.controller.ts`, `src/tenant/tenant-storage-readiness.service.ts`, `src/main.ts`; `/health` is liveness and `/ready` requires both central database and configured tenant-storage provider health. Per-target index readiness remains an activation/use-time check, not a global probe. HTTP and disposable integration tests cover unavailable dependencies. Production monitoring, alerts, and deployment operations remain unverified. |
| Backup/recovery operations | **Blocked by external decision** | `src/recovery/disposable-recovery-artifact.ts`, `PHASE_49_DISPOSABLE_RECOVERY_REPORT.md`, `TENANT_STORAGE_RECOVERY_SPECIFICATION.md`, and Phase 50 describe disposable backup/restore evidence, not scheduled isolated production backups or approved RPO/RTO. |
| AI/RAG, voice receptionist and telephony | **Optional / deferred** | `replit.md` labels the Thanarah AI Voice Receptionist as future/planned, not implemented; no provider selected and no production API/data models are authorized. Do not add telephony dependencies or workflows in this release phase. |

## 4. Proposed initial commercial release scope

This is a **proposal for owner approval**, not a claim that the scope was previously agreed.

### Mandatory foundations before calling the service commercially operable

1. Platform login, session security, tenant membership/permissions, and facility/branch scope.
2. Tenant storage chosen and provisioned with validated TLS, index readiness, and monitored dependency health.
3. Recovery policy and operations: approved coverage, isolation, encryption/key custody, retention, alerting, restore rehearsal, and named RPO/RTO owners.
4. Clear production deployment, migration, monitoring, incident, and rollback procedures for the selected host.
5. Resolve critical/high dependency findings and define explicit trusted CORS origins for any cross-origin production clients.
6. Accessible and usable workflows for staff administration and clinic setup sufficient to provision an operational tenant without manual database editing.

### Essential clinic workflows proposed for the first release

1. Create/manage tenant, facility, branch, memberships, staff, roles, location scope, doctors, departments, specialties, and services.
2. Register and find patients, manage patient lifecycle, and enforce tenant isolation.
3. Staff appointment booking, viewing, rescheduling, cancellation, timezone handling, and configured facility scheduling rules.
4. Clinician encounter creation, documentation, diagnoses/services, completion, history, and reasoned amendment workflows.
5. Operational audit/recovery review and support procedures appropriate to the selected deployment.

Backend foundations for items 1–4 exist. Tenant organizations and existing-account membership lifecycle now have an authenticated platform workspace. Patient, catalog, and doctor administration also have authenticated browser acceptance for the tested synthetic workflows. The existing appointment and encounter workspaces have broader operational recovery and rollout acceptance still outstanding.

### Commercial requirements needing explicit owner selection

The commercial release cannot be fully specified from code alone. Confirm whether the product may launch with manual subscription assignment and off-platform clinic payment, or requires in-product SaaS billing. Separately decide whether clinics must issue invoices, collect patient payments, process refunds, submit insurance claims, or use Saudi-specific payment/healthcare integrations at launch. No price, tax, cancellation, insurance, or payment rules are proposed here.

## 5. Optional or deferred scope

Unless the owner changes the initial-release decision, keep these out of the first implementation sequence:

- Prescriptions, medication ordering/dispensing, referrals, clinical document/attachment workflows.
- Insurance eligibility, claims, and reconciliation.
- Patient self-service portal or mobile applications.
- Public online booking, clinic website builder, custom domains.
- CRM, campaigns, and marketing automation.
- Clinic finance/accounting suite and patient payment/refund workflows.
- Automated SaaS payment collection, renewal/dunning, and usage billing.
- WhatsApp/SMS/email notifications and communications automation.
- Analytics dashboards and advanced operational reporting.
- AI/RAG, voice reception, and telephony (explicitly future/planned in `replit.md`).

“Deferred” is a proposed product boundary and requires owner approval; it does not erase any previously approved external requirement.

## 6. Backend/frontend gap matrix

| Product area | Backend/API status | Frontend status | Gap to close |
|---|---|---|---|
| Authentication/workspace selection | Login, refresh, logout, logout-all, `/session/tenants` API | Login/session and workspace states are embedded in `/appointments/` and `/encounters/`; no standalone platform shell was found | Consolidate sign-in, workspace selection, recovery/error states, and navigation after scope/roles are agreed. Avoid duplicating authentication logic. |
| Tenant/platform administration | Tenant and membership lifecycle APIs | `/platform-setup/` manages organizations and memberships for existing platform accounts; `/team-setup/` assigns existing tenant roles | Platform-user registration and email invitation delivery are absent; initial-owner transfer/removal remains constrained by policy. |
| Facilities/branches/staff/scope | APIs, repositories, policies, and tests exist | `/clinic-setup/` manages facilities/branches; `/team-setup/` manages staff and facility/branch scope | Keep scope checks server-enforced; responsive/accessibility acceptance remains in the later web-experience stage. |
| Healthcare catalogs | Doctor, department, specialty, service, and assignment APIs | `/catalog-setup/` manages catalogs; `/doctor-setup/` manages doctors and facility/branch-scoped service assignments | Appointment service filtering by doctor/location and consolidated cross-doctor assignment review remain separate proposals #80 and #81. |
| Patients | Tenant CRUD/search APIs and storage safeguards | Arabic/RTL directory, profile, registration/edit, search, and lifecycle UI uses the shared authenticated API client; read/manage permission codes control access and sensitive fields are shown only on the protected profile. Authenticated disposable-browser verification includes reload persistence. | Core patient-management gap is closed. Complete broader permission-denied browser coverage, accessibility/localization review, and supported-browser rollout acceptance before launch. |
| Appointments | API, policy, timezone, collision/idempotency controls | Arabic/RTL staff workspace exists and is tested | Productize after approved policy defaults and origin configuration; include operational conflict/recovery states, accessibility, and browser coverage. Public booking is separate and absent. |
| Encounters | API and clinical data model/workflows exist | Arabic/RTL encounter workspace exists with tested browser flow | Close documented edge gaps and support review tooling; keep clinical fields out of analytics/storage and preserve permission-aware behavior. |
| Plans/subscriptions/entitlements | Platform admin APIs, definitions, lifecycle and decision services | No SaaS admin UI found; no billing | Decide manual vs automated billing and entitlement enforcement, then create the correct commercial admin UI. |
| Invoices/payments/insurance/communications | No backend evidence found | No UI evidence found | Owner must decide whether these belong in first release; then choose policy/provider before API or UI design. |
| Recovery, support, monitoring | Disposable artifact and health/readiness foundations | No operator support console found | Production operations, alerting, audited recovery review, and runbooks are needed; do not expose unverified recovery controls as ordinary tenant UI. |

## 7. Dependency-aware implementation roadmap

Sequence is ordered by prerequisite and risk. Backend APIs that already exist should be stabilized and accepted before adding corresponding management screens. The final UI consolidation/redesign remains last.

### Gate 0 — Resolve product and infrastructure decisions

**Dependencies:** owner, security, and infrastructure decisions; no code design should preempt these.

- Approve the tenant MongoDB provider/topology, region/residency, network access, least-privilege identity, capacity, and operational owner. Do not infer a provider from disposable test containers.
- Approve backup coverage, failure-domain isolation, encryption/key custody, retention, alert routing, consistency expectations, RPO/RTO, restore and activation gates.
- Decide the initial commercial boundary for clinic billing, SaaS billing, invoicing, patient payments, insurance, and communications.
- Confirm any required launch-country integrations, languages, consent, retention, and organization roles from documented business requirements.
- Supply the trusted production/staging browser origins if the UI is cross-origin. Current CORS deliberately fails closed outside development.

**Acceptance:** named decision owners and written decisions exist; none are encoded as unapproved defaults or treated as verified production evidence.

### Gate 1 — Close operational/security release blockers

**Dependencies:** Gate 0 for tenant-storage and recovery choices.

- Backend/Infrastructure: implement and rehearse production backup, restore, isolation, key custody, alerting, and guarded activation for central MySQL and all registered tenant stores.
- Backend/Security: resolve outstanding dependency advisories. Prisma 7, Zod 4, Swagger 12, and Vitest upgrades need compatibility work; the Vitest npm resolver failure must be diagnosed without bypass flags.
- Backend/Infrastructure: verify readiness and monitoring against the approved deployment design without leaking sensitive configuration. Current `/ready` already checks central database and tenant-storage provider health; it does not enumerate every tenant target.
- Security/Frontend: configure a narrow trusted-origin allowlist and verify credentialed CORS in staging; preserve fail-closed defaults.
- Operations: verify exact production-like deployment, migrations, logs, monitoring, incident response, and safe application rollback in approved staging.

**Schema/permissions:** additive schema changes only if approved recovery controls require them; do not add production migrations before design review. Existing security and tenant permissions remain authoritative.

**Acceptance:** approved disposable/staging rehearsal proves complete restore and tenant isolation; expected dependencies affect readiness; clean install/build/audits/tests pass; origins are allowlisted; deployment and rollback procedures are exercised. No production deployment is implied.

### Gate 2 — Complete tenant setup and administration workflows

**Dependencies:** Gate 0 decisions; stable auth, tenant, membership, role, facility, branch, staff, and catalog APIs; Gate 1 security controls before launch.

- Backend: close documented lifecycle/operational gaps in tenant owner transfer/removal and recovery/support administration only after policy decisions.
- Frontend: Phase 55/56 add facility/branch setup and a membership directory with staff profiles, role assignments, and facility/branch scopes. Doctor, catalog, tenant-provisioning, and existing-account membership workflows are now authenticated-browser verified. Platform user creation and email delivery remain out of scope.
- Database: use existing Prisma models/migrations where adequate; add schema only for owner-approved requirements.
- Permissions/scope: platform provisioning permissions must remain separate from tenant permissions; verify tenant, facility, and branch boundaries on every action.

**Acceptance:** a synthetic tenant can be established end to end without manual database edits; authorized roles can manage the required setup; unauthorized, cross-tenant, inactive, and out-of-scope users are denied; operations persist and survive reload; API and browser tests cover lifecycle and error states.

### Gate 3 — Complete patient administration and staff clinic workflows

**Dependencies:** Gate 2 tenant setup; existing tenant patient/catalog APIs; approved launch policy.

- Frontend: patient directory, registration, search, profile/read/edit/lifecycle workflows; integrate with the existing appointment patient lookup rather than creating a second source of truth.
- Backend: preserve tenant-scoped duplicate constraints, authorization, field validation, and no client-supplied storage routing. Add APIs only for owner-approved workflow gaps.
- Database: use existing MongoDB patient records and indexes; any migration or data disposition requires an explicit plan.
- Permissions: separate patient read, management, and clinical-history permissions; preserve location scope where relevant.

**Acceptance:** authorized staff can find/register/update the correct tenant patient; duplicates and concurrent writes behave deterministically; unauthorized users cannot read or mutate records; data remains isolated; real authenticated browser tests verify patient lookup and CRUD with disposable stores.

### Gate 4 — Operationalize appointment and encounter workflows

**Dependencies:** Gates 1–3 and stable patient, staff, doctor, facility, branch, and service data.

- Backend: retain existing timezone/scheduling/locking/idempotency and encounter optimistic-concurrency/operation-ledger contracts. Close documented gaps without broadening into ledger redesign.
- Frontend: harden current appointment and encounter workspaces for accessibility, localization, loading/error/retry, no-access, ambiguous mutation, and expired-session behavior.
- Business decisions: supply facility time zones and scheduling policy values rather than inventing defaults. Decide who configures cancellation/reschedule notice and availability rules.
- Tests: expand authenticated-browser coverage to failure recovery, current browser/device matrix, and role/location combinations.

**Acceptance:** the appointment-to-encounter journey succeeds for allowed roles; conflicts, ambiguous writes, retries, revoked/expired sessions, and storage outages remain safe; patient data is tenant-bound; no unauthorized clinical content is exposed; APIs and UI agree on local-time semantics.

### Gate 5 — Commercial operations and integrations, if approved

**Dependencies:** explicit commercial scope and provider/policy decisions; stable tenant and subscription foundation.

- If SaaS billing is required: design provider-neutral subscription checkout, payment state reconciliation, renewals, cancellations, refunds/chargebacks, and audit behavior before schemas/UI.
- If clinic invoicing or patient payments are required: specify invoice legal fields, currency/tax rules, payment/refund lifecycle, reconciliation, and Saudi payment provider(s) before implementation.
- If insurance, notifications, CRM, or patient portal are required: define data ownership, consent, permission model, provider and operational responsibilities first.
- Never infer provider choice, fees, pricing, cancellation windows, insurance rules, or legal requirements from current plan/subscription models.

**Acceptance:** signed-off business rules, threat/privacy review, provider sandbox validation, idempotent reconciliation, role/tenant tests, and end-to-end workflows using provider test environments. Do not use live payment or patient data for development tests.

### Gate 6 — Final UI consolidation

**Dependencies:** stable and accepted backend workflows from every mandatory preceding gate and an approved commercial release scope.

- Consolidate navigation, design system, responsive layouts, Arabic/English behavior, accessibility, permission-aware screens, and error/loading/empty states.
- Keep the landing page distinct from authenticated staff workspaces and any future patient-facing product.
- Validate all mandatory journeys through browser tests before replacing the existing pages.

**Acceptance:** every approved mandatory workflow has an agreed screen-to-API contract and authenticated browser evidence across supported viewports/locales; deferred features are not represented as available.

## 8. Mandatory unfinished feature acceptance register

“Mandatory” here refers to the proposed launch scope in Section 4 and must be confirmed by the owner.

| Proposed mandatory item | Remaining work | Acceptance evidence |
|---|---|---|
| Approved tenant storage and recovery | Owner/provider decisions; production-like configuration; isolated backups, restore, keys, alerts, ownership and activation controls | Written approvals; successful timed restore rehearsal for central and every registered tenant target; isolation and index verification; documented RPO/RTO and operator runbook; no production access required for rehearsal evidence. |
| Dependency/security release gate | Compatible fixes or documented risk acceptance for remaining audit findings; explicit CORS origins | Current production/full audit outputs; compatible upgrade/build/test evidence; no resolver bypass; tested allowlist and rejected-origin cases. |
| Production deployment operations | Staging-like host setup, dependency-aware readiness, monitoring, migration/rollback plan | Deployment rehearsal on approved staging; health/readiness and alert tests; validated config by name without exposing values; reviewed migration and rollback procedure. |
| Tenant/facility/staff setup UI | Phases 55–56 deliver authenticated facility/branch setup, a privacy-limited membership directory, staff profile lifecycle, membership/staff role assignment, and staff facility/branch scopes. The platform workspace now creates and manages tenant organizations and memberships for existing platform users. Catalog and doctor administration screens cover available CRUD/lifecycle APIs. | Disposable authenticated Chromium coverage verifies facility/branch and team setup; tenant create/status changes; membership invite/activate/suspend/reactivate/remove; tenant-scoped listing and permission denial; and department, specialty, service, and doctor CRUD/lifecycle. New platform-user registration and email invitations remain open. |
| Patient directory and registration UI | Core workflow implemented and verified in Phase 54; broader permission-denied browser, accessibility, and rollout acceptance remain | Authenticated Chromium flow covers create/search/read/update/lifecycle and persistence after reload. Unit/HTTP and disposable MongoDB tests cover validation, tenant isolation, duplicates/concurrent writes, and storage/index safeguards. |
| Clinic operations workflow | Existing appointment and encounter surfaces require launch acceptance, policy decisions, and role/browser coverage | End-to-end authorized staff journey from patient and appointment through encounter; approved timezone/policy behavior; retry/conflict/session/storage-failure handling; no patient data leakage. |
| Commercial billing boundary | Owner decision whether this is mandatory; no implementation assumed | Written manual-vs-automated SaaS billing and clinic payment/invoice scope decision. If mandatory, provider, pricing/tax, legal and lifecycle rules approved before implementation. |

## 9. Blockers, limitations, and owner questions

### External or operational blockers

- What MongoDB provider/topology, region, network boundary, capacity, and operating owner are approved for production?
- Who owns independent backups, encryption keys, retention, alerting, recovery authorization, and the agreed RPO/RTO?
- What exact origins must staging and production browsers use? Arbitrary credentialed origins remain intentionally denied.
- Which production host, migration sequence, monitoring, incident response, and rollback procedure will be supported?
- Do commercial or healthcare obligations require controls not evidenced in this repository? Obtain qualified review; this roadmap makes no compliance claim.

### Product-owner decisions

- Which clinic workflows are required for the first paid release, and which users/roles must perform them?
- Is first release permitted with manual SaaS subscription assignment, or must checkout, renewals, cancellations, and payment reconciliation be automated?
- Are clinic invoices, patient payments/refunds, insurance claims, or accounting required at launch? If yes, which approved rules, providers, and reconciliation responsibilities apply?
- Is patient self-service, public online booking, or a patient mobile app in the first release?
- Are prescriptions, medication workflows, referrals, clinical documents, or standardized diagnosis terminology in approved near-term scope?
- Are notifications/WhatsApp/SMS required, and what consent, language, retention, and escalation policies govern them?
- Which language(s), accessibility targets, devices, and browser versions are launch requirements?
- What tenant owner transfer/removal process is desired? The current documented membership rules intentionally constrain owner removal/transfer.
- What facility time zones, operating hours, booking horizons, notice periods, and provider availability rules should clinics configure? No defaults are inferred by this roadmap.

## 10. Verification and audit limits

The prior Phase 51 verification recorded:

- Unit/HTTP suite: 103 files, 917 tests passed.
- Disposable MySQL/MongoDB suite: 39/39 passed, including the authenticated browser recovery journey.
- Main TypeScript and tenant-contract TypeScript checks, lint, formatting, build, Prisma validation, JavaScript syntax checks, and `git diff --check` passed; lint had one existing warning.
- Local `/health` returned 200 and `/ready` returned sanitized 503 without a configured database.
- Phase 51 npm audit: production tree 0 critical, 4 high, 2 moderate; full tree 2 critical, 4 high, 4 moderate. Replit dependency scan separately reported 2 critical, 2 high, 4 moderate; SAST and HoundDog returned no findings.

The latest Phase 55 verification recorded:

- Unit/HTTP suite: 103 files, 920/920 tests passed.
- Disposable MySQL/MongoDB suite: 39/39 passed, including the authenticated clinic-setup and encounter browser journey. The setup portion exercised facility/branch create, edit, suspend/reactivate, reload persistence, visible permission denial, and cross-tenant isolation.
- Shared browser API-client tests: 6/6 passed.
- Main TypeScript check, tenant-contract TypeScript check, Nest build, JavaScript syntax checks, formatting, and `git diff --check` passed.
- Full lint passed with one pre-existing warning in `test/encounter-operation-reconciliation.spec.ts`.
- Prisma validation was not run because Phase 55 changes no Prisma schema or migrations.

The November 5, 2026 doctor/catalog acceptance run recorded:

- The authenticated headless Chromium test passed against disposable MySQL and MongoDB containers (1 passed, 38 skipped by name filter). It exercised catalog department, specialty, and service create/edit/suspend/reactivate; doctor create/edit/suspend/reactivate; department/specialty assignments; Staff-backed facility/branch scope persistence; cross-tenant denial; and a user without doctor-read permission.
- The full default suite passed 954 tests across 107 files, with 33 opt-in tests skipped. TypeScript and Nest build passed; lint had zero errors and one pre-existing warning in `test/encounter-operation-reconciliation.spec.ts`.
- No production database, migration, deployment, or production configuration was used.

The latest platform administration acceptance run recorded:

- Authenticated headless Chromium passed against disposable MySQL and MongoDB containers (1 passed, 38 skipped by name filter). It verified tenant create/list/suspend/reactivate; existing-user membership invite/activate/suspend/reactivate/remove; tenant-scoped membership listing; and denied access for a user without platform permissions.
- The full default suite passed 954 tests across 107 files, with 33 opt-in tests skipped. TypeScript and Nest build passed; lint had zero errors and one pre-existing warning in `test/encounter-operation-reconciliation.spec.ts`.
- No production database, schema change, migration, or deployment was used.

Phase 55 did not access production, run migrations, deploy, stage, or commit. Repository tests do not establish production provider approval, backup recoverability, legal compliance, performance capacity, or commercial acceptance. This document should be revised when the owner resolves scope decisions and new implementation evidence exists.
