# Thanarah Master Product Completion Roadmap

**Version:** 1.1
**Updated:** 2026-11-15
**Overall release status:** NOT READY — product completion, current validation, and production operations remain open.
**Production status:** No production database, configuration, migration, deployment, or payment was accessed or changed.

This is the single current status and acceptance register for Thanarah completion. It replaces the former MongoDB-migration-only checklist as the live roadmap; detailed phase reports remain historical evidence. Update this file after each accepted stage rather than creating competing master checklists.

## 1. Product and safety decisions

- **Use MongoDB for the whole platform.** The owner confirmed MongoDB for central identity, sessions, authorization, tenants, subscriptions, configuration, audit, and clinic data. The MongoDB-only development runtime is implemented across 22 central persistence ports. This supersedes the hybrid MySQL/Prisma direction in the 2026-11-11 version of this file. Historical SQL schemas, repositories, migrations, and tests remain for reference; they are not the target runtime and do not authorize data deletion or production migration.
- **Keep tenant boundaries fail-closed.** Never weaken authentication, authorization, trusted tenant context, facility/branch scope, or storage readiness to make a workflow appear complete.
- **No production operations in this program.** Use synthetic data and approved non-production systems only. Do not read or reveal secret values, use production data, deploy, apply production migrations, or make live payments.
- **Use Paymob at the final payment stage.** The owner selected Paymob on 2026-11-15, superseding the earlier Geidea choice. Finish manual bank-transfer receipt and review flows for both clinic invoices and SaaS subscriptions first; complete the rest of the roadmap before sandbox integration. Keep live processing disabled pending separate approval. The accepted task #91 still says Geidea and is stale; do not execute it as written.
- **Do not invent commercial or legal rules.** Clinic invoices and SaaS subscriptions are separate. SAR may be the configurable default requested by the owner; tax rates, legal invoice fields, pricing, refunds, and invoice numbering need approved rules.
- **Do not create a parallel mobile app without approval.** A deeper scan of the working tree, all available branches/remotes, tracked history, and installed dependencies found no mobile app. An external repository not connected to this workspace cannot be ruled out; request its link or an explicit platform/stack decision before creating anything.
- **Keep AI separate from clinical business logic.** AI tools may call only authorized Thanarah services; no unrestricted database access, arbitrary queries, or unapproved transfer of patient data to external providers.
- **Keep external channels disabled until approved.** The user described a per-clinic WhatsApp linked-device direction using Baileys, but the communication adapter remains disabled and no live provider is connected. Provider suitability, consent, account ownership, retention, OTP, and voice requirements must be confirmed before live messaging or calling.
- **Phase 01 is accepted for development, not production.** On 2026-11-15 the owner accepted the MongoDB foundation and authorized Phase 02 internal-company development with configurable, independently approved policies. This does not accept production readiness, permit data cutover, or authorize publishing or real transactions.

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
| Central platform storage and identity | **MongoDB-only development runtime implemented; production gate open** | `THANARAH_MONGODB_CONVERSION_PROGRESS.md` records all 22 central persistence ports on MongoDB, no Prisma provider in the compiled runtime, and 78 isolated Mongo tests. Phase 01 was accepted for development on 2026-11-15. Production topology, cutover, backup/restore, and release acceptance remain open; task #117 still appears pending and needs status reconciliation. |
| Authentication and authorization | **Core flows implemented; complete account lifecycle and current preview unverified** | Password login, refresh rotation, logout, role and tenant authorization have recorded HTTP and integration coverage. Email verification/reset and unified role-specific account journeys remain in task #116. The customer refresh-cookie fix added during this session has not been verified in the running preview because the application workflow currently fails to start. |
| Tenant, clinic and catalog setup | **Core development workflows implemented and synthetically tested** | Tenant membership, facility/branch, staff scope, departments, specialties, doctors, services, doctor-service assignment, patients, and staff scheduling have focused evidence. Owner changes, broad accessibility/browser coverage, and draft proposals #73/#74/#80/#81 remain separate. |
| Internal company operations | **Development workspace implemented; operational setup and stage acceptance remain** | `/company/` covers organization, employee access, HR contracts, lead/CRM stages, requests and independent review, ledger, configurable payroll/commission/profit policies, and executive views. The Phase 02 report records 23 isolated tests and an authenticated finance browser flow. No live staff, salaries, accounting setup, or approved policies were seeded; task #111 remains open. |
| Customer journey and packages | **Connected development flow with secure OTP path; not closed** | `/welcome/`, `/customer/`, and `/customer-admin/` cover service/package catalog, customer profiles, requests, documents, review, account assignment, activation/handover, renewal, invoices and audit. A server-side WhatsApp challenge and preview AI bootstrap are configured in development, but neither provider has received a live verification request. Package publication, seller/numbering and payment data still require approved business configuration; Task #112 remains open. |
| Smart Clinic | **Core clinic setup, patient, staff appointment and encounter scope exists; full medical scope remains** | Existing records cover patient, appointment/scheduling policy, encounter notes, vitals, diagnoses, services and clinic finance. The requested integrated workflow still needs prescriptions/medications, lab and imaging orders/results, insurance approvals, public booking and role-specific acceptance. Task #118 remains open. |
| Clinic invoices and SaaS subscriptions | **Separate foundations exist; full payment paths do not** | Tenant invoice settings/drafts/review/issue and subscription lifecycle are separate. SaaS subscription receipt submission exists for manual review, but the two-flow bank-transfer task #108 still requires the patient-invoice path and both reviewers. No automatic collection, renewal charge, refund, or reconciliation is enabled. |
| Responsive bilingual web product | **Selected web workflows tested; broader rollout remains** | Shared Arabic RTL/English LTR behavior is recorded for existing workspaces. Human terminology review, screen-reader coverage, and a wider browser/device matrix remain; task #121 continues shared interface/auth work. |
| Clinic Website Builder | **Not present as a customer editor/publisher** | The public Thanarah marketing site is not a clinic's editable website. Templates, drag/drop, clinic domain, booking linkage, version restore, and test-domain publication remain in task #113. |
| Customer projects and GitHub | **Not present as an end-to-end customer workflow** | No verified per-customer repository, reviewed change, approved deployment, log, or rollback journey exists; task #114 depends on the customer site work. |
| AI and assistants | **Tenant-safe synthetic foundation; requested assistants and live activation remain** | `/ai-admin/` provides agent/tool/knowledge/budget/audit foundations and local lexical retrieval. Semantic Arabic retrieval, bounded memory, and role-specific account-manager, support, clinic and patient assistants need acceptance in task #119. Hosted inference, embeddings, voice, and patient data transfer remain disabled. |
| WhatsApp, voice and workflow automation | **Consent and synthetic channel foundation only** | `/communications/` records consent/retention and simulated delivery/call/handoff events with a disabled provider boundary. The desired Baileys linked-device approach is not an active integration; OTP, live messages, voice, human task execution, provider terms, and consent policies remain open. |
| Marketing and mobile | **Partial public marketing only; marketing operations and mobile app absent** | The public Thanarah site is not a campaigns/lead-source/Maps system. Campaign analytics and permitted Maps sourcing remain in #115. No Android/iOS app exists in this workspace; target audience and platform decision remain open. |
| Security, test and release readiness | **Not ready for release** | The latest recorded general run on 2026-11-14 reports 1,055 passed and 121 skipped; build and primary TypeScript checks passed, while ESLint reported 193 errors and 265 warnings. The Nov-09 dependency/SAST scans are not fresh. Approved production CORS origins, independent security review, recovery objectives, production Mongo topology, and backup/restore evidence remain open. |

## 4. Roles, journeys, and remaining work

### Role and scope matrix

This table is the target access model for review. It does not claim that every target role is already provisioned or fully tested.

| Role or scope | Required visibility and actions | Current boundary |
|---|---|---|
| CEO / General Manager | Company-wide operating summaries and approvals explicitly assigned by policy | Company dashboards and policy approval foundations exist; production policies and staff are not configured. |
| CTO / technical lead | Technical health, incidents, projects, deployments and rollback evidence | A technical dashboard exists; production monitoring and customer deployment workflow are not established. Do not grant payroll or finance by default. |
| Thanarah Finance | Invoices, ledger, transfer review and reconciliation within assigned permissions | Internal ledger foundation exists; bank transfer for both billing flows and payment reconciliation remain incomplete. |
| Account Manager | Assigned customer profile, documents, requests, follow-up and handover | Customer-to-employee assignment exists in the development journey; assignment data and complete operational process remain open. |
| Thanarah employee | Only assigned cases, departments, approvals and records | Platform identity and authorization exist; the full approved company role matrix is not yet accepted. |
| Clinic owner / administrator | Own clinic, facilities, staff, subscriptions and clinic-site settings | Tenant boundaries and membership foundations exist; Website Builder is not present. |
| Clinic receptionist | Patient lookup and appointment actions within assigned facility/branch | Core clinic staff workflows exist; public booking and the complete role test matrix remain. |
| Nurse / clinician | Nurse-scoped vitals; clinician-scoped encounter, diagnosis and prescription actions | Existing patient/appointment/encounter scope exists; prescriptions and finer clinical role boundaries remain. |
| Lab / imaging / pharmacy / insurance / clinic finance | Only the relevant order/result, dispensing, approval or financial workflow | These end-to-end role workflows are not established as complete; covered by Smart Clinic task #118. |
| Patient | Own profile, booking, visit information, invoices and channel consent only | No complete patient self-service account and invoice journey is accepted; verified account-to-patient linkage and channel delivery are open. |

Server-side authorization, tenant/facility/branch isolation, independent approval, and audit evidence are required for every role. UI hiding alone is not access control.

### Connected user journeys

| Journey | Responsible roles and source of record | Existing evidence | Remaining acceptance |
|---|---|---|---|
| Clinic customer: discover → choose package → register → profile/documents → review → account manager → activation → handover → renewal | Customer, account manager, independent reviewer, finance; customer-journey records linked to platform identity and SaaS subscription | `/welcome/`, `/customer/`, and `/customer-admin/` are connected in development. The owner supplied Lite at SAR 199/month (10% annual discount) and Pro at SAR 359/month (15% annual discount), with base features; the public catalog remains unpublished. | Live phone delivery is unverified; Lite's extra-year discount, Customize contents, Pro integration details, and request terms remain undefined. Seller/bank details, manual payment for both flows, and the complete accepted customer-to-handover test also remain. |
| Patient: clinic/service → booking → arrival → visit → clinical orders/results → invoice → follow-up | Patient, reception, nurse, clinician and scoped clinical/finance roles; tenant MongoDB records with a trusted tenant context | Staff appointments and the documented patient-to-appointment-to-encounter path have synthetic integration/browser evidence. | Public booking, prescriptions/medications, lab, imaging, insurance, patient invoice access, and the full role-by-role journey remain. |
| Company operations: lead/request → assignment → independent review → approved policy/contract → accrual/ledger → executive view | Account manager, employee, independent approver, Finance, CEO/CTO; company CRM and audited ledger | `/company/` development workspace and 23 isolated phase tests are documented in `docs/PHASE_02_INTERNAL_OPERATIONS.md`. | Real organization/staff/policies are not configured; payroll rules, approvals, reconciliation, and the stage’s full acceptance remain open. |
| Client website and code change: request → site/project → GitHub review → test → approved deployment → logs/rollback | Customer, authorized reviewer, CTO; versioned site/project and GitHub records | The Thanarah public site exists; it is not a customer Website Builder or GitHub deployment system. | Clinic editor/publishing is task #113; customer repository, review, deployment approval and rollback are task #114. |
| AI and communications: authenticated role → tenant-scoped knowledge → authorized action → consented channel → audit/follow-up | Patient/clinic staff/account manager/support agent; tenant knowledge and authorized Thanarah business services | AI and communications foundations support synthetic content, scoped retrieval, consent, and simulated events. | Role-specific assistants, semantic retrieval, live provider approval, OTP, voice, execution/handoff, quality and cost measurement remain. |

### Now / Next / Later

| Horizon | Work and gates |
|---|---|
| **Now** | Complete this master-baseline update (#120); reconcile the MongoDB-only implementation evidence and Phase 01 acceptance with the still-pending #117 task; restore the application workflow and verify customer session restoration before claiming the current preview works; keep the stale Geidea task #91 from being executed after the Paymob decision. |
| **Next** | Continue identity/shared-auth work (#116, #121, #122); complete company operations (#111) and Smart Clinic (#118); then close the customer journey (#112) and manual bank-transfer workflows (#108) with the exact approvals and policies configured. |
| **Later** | Build the customer Website Builder (#113) before client GitHub projects (#114); complete role-specific AI acceptance (#119) after the clinic workflows; complete marketing (#115) after its CRM, customer, AI and communications dependencies; choose a mobile target before creating an app. |
| **Final gates** | Only after the rest of the product and manual transfer paths are accepted: replace the stale Geidea plan with Paymob, use its test environment, and keep production charges disabled until separate authorization. Complete production topology/TLS, approved CORS, backup/restore/RPO/RTO, fresh security checks and release approval separately. |

No overall completion date is reliable yet. Policies, external providers, mobile target, production operations, and several full end-to-end acceptance paths remain unresolved.

### Current project-task inventory (queried 2026-11-15)

The task queue contained **14 accepted open tasks** (13 waiting to start and one marked in progress) and **22 draft proposals**. This inventory records the queue; it does not change, cancel, or reorder accepted tasks.

| Task | Current record | Scope and dependency |
|---:|---|---|
| #120 | Tracker showed pending at the inventory query; this document is being updated | Update this single baseline. The tracker state was not changed as part of the documentation review. |
| #117 | Pending, despite MongoDB-only implementation evidence | Reconcile/close the platform MongoDB work against its acceptance; do not repeat conversion or require MySQL. |
| #116 / #121 / #122 | Pending | Unified identity/account lifecycle and web entry; phone-country selector depends on identity. Live OTP is still disabled. |
| #111 | Pending; development operations are implemented and tested | Company operations. The 2026-11-15 Phase 02 report records 23 isolated tests, but real staff, finance setup and approved policies are absent. |
| #112 | Pending | Complete the customer journey; depends on #111 and remains blocked on live verification and full acceptance. |
| #118 | Pending | Complete Smart Clinic medical workflows and role tests. |
| #113 → #114 | Pending | Clinic Website Builder after #112, then customer projects/GitHub after #113. |
| #119 | Pending | Role-specific Thanarah AI after #118. |
| #115 | Pending | Marketing; depends on #112, #111, #88 and #89. |
| #108 | Pending | Manual transfer receipt/review in both patient invoices and SaaS subscriptions before payment-provider integration. |
| #91 | In progress but stale | Still titled Geidea. Paymob was selected on 2026-11-15; do not execute the old plan. The task record requires later replacement or reconciliation. |

The 22 draft proposals are grouped as follows: membership/permission and appointment/catalog UX (#73, #74, #80, #81); package, web-origin, language and invoice decisions (#92–#97); mobile direction/build (#98, #99); semantic AI, concurrency and provider activation (#100–#102); WhatsApp/provider, human handoff and patient consent (#103–#105); financial/communications and backup/restore acceptance (#106, #107); and subscription/migration guardrails (#109, #110). They are not treated as implemented or as accepted work.

## 5. Architecture and release gates

### Persistence boundary

- MongoDB is the owner-approved target for all platform and tenant persistence. The current development runtime routes all 22 central persistence ports through MongoDB; the compiled application does not register Prisma.
- SQL schemas, migrations and legacy tests remain in the repository as historical material. They are not current runtime requirements and do not authorize deleting SQL sources or migrating existing/production data.
- Keep clients from selecting physical database names or connection strings. No cross-tenant fallback, dual writes, or weakening of storage readiness.
- The older `PHASE_60_MIGRATION_READINESS_DECISIONS.md`, `THANARAH_MONGODB_MIGRATION_DECISIONS.md`, and `TENANT_MONGODB_DEPLOYMENT_DECISION.md` document prior migration constraints. Read them as historical context; they do not override the later MongoDB-only owner decision or authorize a production cutover.

### Security and operations

- The latest recorded general run (2026-11-14) reports 1,055 passed and 121 skipped. Build and primary TypeScript checks passed; full ESLint reported 193 errors and 265 warnings. These results were not rerun for this document update. The focused Phase 02 report separately records 23/23 tests, build and TypeScript checks, plus a development `/health` and `/ready` check on 2026-11-15.
- The most recent recorded dependency/SAST/HoundDog results are from 2026-11-09: 0 critical, 0 high, 5 moderate dependencies; 0 SAST and 0 HoundDog findings. These scans are stale for release decisions and are not a penetration test.
- Staging/production CORS rejects all origins until an owner-approved allowlist is configured. Do not invent production origins or open cross-origin access to make clients connect.
- Development MongoDB health/readiness returned 200 in the 2026-11-15 Phase 01/02 evidence. Separately, the current configured “Start application” workflow is failing at `npx nest build` with `npm error could not determine executable to run`; the current preview and the customer session fix have not been verified. Do not treat the earlier endpoint result as proof that the current preview is running.
- No approved MongoDB production provider/topology or transaction profile is documented. TLS/certificate validation, network access, residency, operations ownership, and failure behavior still require evidence.
- Backup/restore has not been demonstrated on an approved production-equivalent source and separate restore target. RPO/RTO and restore timing are therefore not measured.
- A test pass or local `/health` response does not prove production readiness. `/ready` and any database-dependent verification must be reported separately.

### Commercial, AI, and communications boundaries

- Separate clinic invoices from platform SaaS subscription assignment. Do not infer tax, pricing, legal invoice wording, refund, cancellation, or payment rules.
- SAR is a configurable default requested by the owner, not a hard-coded legal conclusion.
- Paymob is the selected payment provider; its integration is not active. Geidea is superseded and its task is stale. Baileys is the requested WhatsApp linked-device direction, not an active provider integration. AI hosting, embeddings, vector storage, external telemetry, and voice provider remain unselected. Use approved secret handling; never print credentials.
- Do not put protected health information into external model calls, analytics, or test fixtures without explicit approval and an appropriate privacy/security review.
- Paymob sandbox work is last, after task #108 and full product acceptance; production processing requires another explicit authorization.

## 6. Repository and workflow state

- This update changed documentation only. No application source, database, environment setting, secret, project-task state, or deployment was changed.
- The configured application workflow has failed twice at `npx nest build` with `npm error could not determine executable to run`. No successful restart or current browser preview is available for this update.
- The accepted Phase 01/02 reports record development-only MongoDB setup and tests. No production data access, production migration, live provider request, deployment, or real payment was performed for this update.

## 7. Acceptance log

Older rows record the decisions and checks known on their dates. Where they name MySQL or Geidea, they are historical and superseded by the decisions in Section 1.

| Date | Stage | Result and evidence | Limits / next gate |
|---|---|---|---|
| 2026-11-08 | A — Inventory and master register | Reviewed current source, `replit.md`, README, product roadmap, MongoDB decisions, Phase 51/60/61/62 reports, task queue, branch list, and code/test references for doctor-service assignments. Replaced this file's MongoDB-only checklist with the current A–J product roadmap and acceptance register. | Documentation review only; no tests were rerun for this task. Previously recorded verification after the doctor-service assignment work: 966 tests passed, 33 skipped; Phase 30 integration suite 39/39; build, type-check, formatting, and Prisma validation passed; lint had one existing warning. These are prior results, not validation of the present documentation edit. No production data or secrets were accessed. |
| 2026-11-08 | B — Security and operational readiness | Updated Vitest and coverage to 5.1.0, Zod to 4.6.7, `@nestjs/swagger` to 11.4.8, and `@fastify/static` to 10.1.10; used a scoped `deepmerge-ts` 8.0.2 override so Prisma 6 remains in place. Removed the configured admin email from bootstrap success and duplicate-account output. Fresh scans: 0 critical/high, 5 moderate; SAST complete with 0 findings; HoundDog 0 findings. `npm test`: 966 passed, 33 skipped; focused auth/CORS/storage checks: 135 passed. Build, both type checks, formatting, Prisma validation, script syntax, and diff checks passed. Lint had 0 errors and 1 existing warning. The app restarted successfully; readiness remains unavailable because the sanitized development database check reports a non-MySQL URL. | No Phase 30 database integration or backup/restore exercise was run. The development MySQL configuration was diagnosed as non-MySQL through sanitized checks; no secret value was inspected. Production/staging origins, Mongo provider/topology, transaction profile, isolated recovery target, and RPO/RTO remain unapproved or unverified. No production data, secrets, migrations, or deployment were used. |
| 2026-11-09 | C — Clinic and clinical workflows | Prevented stale tenant responses from overwriting clinic, team, catalog, and doctor workspaces; cleared prior-tenant UI data on workspace changes; exposed branch-load failures with retry; limited staff scope choices to active locations. Reconciled stale frontend claims in the product roadmap. `npm test`: 970 passed, 33 skipped. Phase 30 disposable integration: 39/39 passed, including the authenticated Chromium journey. Focused workspace-switch regressions: 4/4 passed. Build, type-check, format, and diff checks passed; lint had 0 errors and 1 existing warning. | Synthetic disposable MySQL/MongoDB only; no production data, secrets, migrations, or deployment. One initial Phase 30 run hit the auth login throttle because tests shared an IP; the outage test now uses a dedicated synthetic test IP and the full rerun passed. Production topology, recovery objectives, and other Stage B approvals remain unresolved. |
| 2026-11-09 | D — Web experience and responsive behavior | Added a shared locale control, translation map, and responsive/accessibility presentation layer to the nine current staff/platform workspaces. Arabic/RTL remains the default; English/LTR persists in browser storage. Date/number formatting follows the selected locale, and user-provided names/IDs are excluded from translation. The final targeted Phase 30 authenticated Chromium journey passed: 1 passed, 38 skipped; it checks keyboard activation/focus, English permission-denied states, the 390px appointment layout with no page overflow, and restores Arabic for subsequent role checks. `npm run format:check`, `npm run type-check`, and `node --check` passed; lint had 0 errors and 1 existing warning; `git diff --check` passed. | Synthetic disposable test infrastructure and one Headless Chromium version only. Human review of English clinical wording, full screen-reader testing, and broader browser/device coverage remain open. No API contracts, authorization, authentication, production data, secrets, migrations, or deployment were changed. |
| 2026-11-09 | E — Clinic finance foundation | Added tenant-scoped Mongo finance settings and invoice records, separate permissions, settings revisions, idempotent drafts, integer-minor-unit calculations, review/issue history, sequence reservation recovery, and the Arabic finance workspace. New draft prices/quantities are blank; changing the configured currency requires re-entering draft prices. Sequential counters persist across settings and numbering-mode changes; the initial number seeds an uninitialized counter only. `npm test`: 987 passed, 33 skipped (112 files passed, 2 skipped). Build, both type checks, format check, browser-script syntax checks, and `git diff --check` passed. Lint passed with 0 errors and 42 explicit-return-type warnings. The app restarted and mapped all finance routes; the preview rendered the unauthenticated sign-in screen. | No payment collection, Geidea call, refund, accounting ledger, legal-compliance claim, default tax, or patient linkage. Mongo adapter tests use mocks; a production-like tenant MongoDB integration and signed-in visual verification remain outstanding. The configured development central database is rejected as non-MySQL, so authenticated database-backed UI could not be verified. No live database migration, production data, secret access, or deployment was used. |
| 2026-11-09 | F — Mobile readiness | Searched the working tree, all available local/remote refs (`main`, `replit-agent`, `gitsafe-backup/main`, and `origin/main`), tracked history, project directories, package dependencies, and mobile-related task/product notes. No Flutter, React Native/Expo, Capacitor/Ionic, Android, or iOS app was found; the existing appointment API client is browser-oriented. No mobile code, framework, API, permission, signing key, or store configuration was added. The owner must link any external app or explicitly select a starting platform before implementation. | This check covers only the connected workspace and Git refs; a separately hosted repository cannot be inspected without its link. No emulator, offline, mobile-role, or device tests were run because there is no app to test. No production systems, credentials, signing material, or store accounts were used. |
| 2026-11-09 | H — Channels and automation | Added permission-gated `/communications/` UI and tenant APIs for per-channel consent/opt-out, explicit retention, synthetic simulation, normalized delivery/call/handoff events, idempotency, and redacted status history. The webhook boundary captures raw bytes, supports challenge verification through a provider adapter, and includes a constant-time HMAC-SHA256 helper; the default adapter remains disabled. `npm test`: 1,013 passed, 33 skipped (114 files passed, 2 skipped); the focused communications suite passed 14/14. Build, both type checks, format check, frontend syntax checks, and `git diff --check` passed. Lint had 0 errors and 44 warnings in unrelated finance/encounter files and existing test helpers. The app restarted and mapped all communications routes; 1280px and 402px previews rendered the sign-in screen. | The previews were unauthenticated; signed-in UI and database-backed API behavior were not visually verified. The development central database URL was rejected as non-MySQL at startup. The HMAC helper was tested with synthetic bytes, not a live provider. No provider, credentials, external requests, live messages/calls, retry worker, or handoff execution were enabled. The migration was not applied; no production data, secrets, or deployment were used. |
| 2026-11-09 | I — Final product acceptance | The first fresh Phase 30 run exposed an English-locale failure (38/39) because the communications translation extension replaced the appointments dictionary. Changed the extension to preserve and merge the existing route dictionary. The focused signed-in Chromium journey then passed; the full disposable Phase 30 run passed 39/39. `npm test`: 1,013 passed, 33 skipped (114 files passed, 2 skipped). Build, both TypeScript checks, format check, JavaScript syntax, and `git diff --check` passed; ESLint had 0 errors and 44 warnings in existing files. Fresh scans: dependency audit 0 critical, 0 high, 5 moderate; SAST 0; HoundDog 0. `/ready` returned HTTP 503 with sanitized `DATABASE_UNAVAILABLE`; the current development central database is not usable. Phase 61/62 restore rehearsal remains NOT RUN. | Core authenticated clinic-to-encounter flows passed with disposable synthetic MySQL/MongoDB and headless Chromium. Signed-in finance/communications production-like journeys, backup/restore, approved MongoDB topology, production CORS origins, and production operations remain unverified or blocked. No production data, secrets, migrations, deployments, or payments were used. Geidea remains Stage J and was not started. |
| 2026-11-11 | #108 — Clinic subscription self-service | Added tenant-scoped subscription details and bank-transfer receipt submission to the finance workspace, with distinct owner/admin permissions, trusted tenant resolution, an active-subscription check while locking the subscription row, and a response that excludes receipt bytes and internal tenant fields. The receipt is stored for manual review only; no amount is shown or inferred, and no subscription extension or collection occurs. Disposable MySQL 8.0.42 and authenticated Chromium test harness passed 8/8 focused API, permission, database, and browser UI tests. Build, TypeScript, format, JavaScript syntax, and ESLint completed with 0 errors (89 existing/explicit-return-type warnings). | The patient invoice portal remains blocked. The owner selected WhatsApp OTP to the phone on the patient record and an existing platform login account, but no WhatsApp delivery path is available; no account-to-patient link or portal access was implemented without a deliverable verification code. For the isolated MySQL run, a temporary migration copy omitted the pre-existing empty `20261008110000_patient_tenant_storage_boundary` folder because it has no `migration.sql`; the source migration catalog still needs that issue resolved before normal `prisma migrate deploy` can complete. No production database, data, credentials, migration, deployment, Geidea, sandbox, or real payment was used. Task #91 is deferred. |
| 2026-11-12 | #108 — Patient portal and WhatsApp scope decision | Recorded the owner’s decision to use the existing platform login and WhatsApp OTP to the patient’s stored phone. The desired future channel is a native, tenant-isolated WhatsApp linked-device flow using Baileys: an authorized admin connects manually, the session is encrypted and retained, no automatic connection occurs on restart or update, and outgoing messages are spaced by three seconds. Each clinic may link its own number for its patients. | This multi-clinic WhatsApp subsystem is broader than the current #108 delivery and will not start until the owner reviews this report. No QR, session, credentials, WhatsApp code, or live message was handled. Keep patient invoices inaccessible until ownership is securely verified. |
| 2026-11-15 | #120 — Master product baseline refresh | Reconciled the roadmap with the MongoDB-only development runtime, the owner’s Phase 01 acceptance and Phase 02 authorization, the Paymob decision, open-task inventory, current evidence limits, role boundaries, and end-to-end user journeys. Distinguished existing development features from incomplete or unaccepted workflows and added Now/Next/Later gates. | Documentation-only review. No general test suite or fresh security scan was run. The current application workflow still fails to start, so the preview and customer session fix are unverified. The accepted-task queue was not edited or reordered. No application code, data, secrets, deployment, or payment was changed. |

### Next evidence to record

For every later stage, append a dated row with: scope changed, tests actually run and counts, browser/device/locale coverage, database/provider used (never secret values), known skips/failures, production boundary, and explicit acceptance or blocking reason. Do not copy results from a prior report as if they were rerun.

## 8. Source reports retained

These documents remain detailed evidence, not competing live roadmaps:

- `THANARAH_PRODUCT_COMPLETION_ROADMAP.md`
- `THANARAH_REMAINING_BLOCKERS.md`
- `THANARAH_MONGODB_CONVERSION_PROGRESS.md`
- `THANARAH_MONGODB_MIGRATION_DECISIONS.md`
- `TENANT_MONGODB_DEPLOYMENT_DECISION.md`
- `PHASE_01_CORE_FOUNDATION_REPORT.md`
- `docs/PHASE_02_INTERNAL_OPERATIONS.md`
- `docs/PHASE_03_CUSTOMER_JOURNEY.md`
- `PHASE_51_SECURITY_HARDENING_REPORT.md`
- `PHASE_60_MIGRATION_READINESS_DECISIONS.md`
- `PHASE_61_BACKUP_RESTORE_TEST_REPORT.md`
- `PHASE_62_BACKUP_RESTORE_RESULTS.md`
