# Thanarah Core Platform

Enterprise healthcare SaaS backend — NestJS 11 + Fastify + MySQL/MariaDB (Prisma), targeting Saudi Arabia and the wider region.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Framework | NestJS 11 + Fastify 5 |
| Central persistence | MySQL / MariaDB on cPanel — via Prisma 6 |
| Tenant persistence | Isolated MongoDB database(s) per tenant — permanent future architecture, not implemented |
| Language | TypeScript 5 (strict) |
| Validation | Zod |
| API Docs | Swagger / OpenAPI at `/docs` |
| Testing | Vitest |

## Architecture — two persistence systems (never mixed)

| System | ORM | Database | Scope |
|--------|-----|----------|-------|
| **Thanarah Central Platform** | Prisma 6 | MySQL / MariaDB on cPanel | Global identities, authentication, sessions, roles, permissions, tenant identity and memberships, and other platform metadata |
| **Tenant Healthcare and Operations** | Not selected yet | Isolated MongoDB database(s) per tenant (future) | Tenant-owned healthcare and operational data |

Tenant healthcare and operational data will use isolated MongoDB database(s)
per tenant in a future phase; MongoDB is **not implemented**. Phase 14A adds a
central-platform Tenant/Organization identity; Phase 14B adds its central
platform-user membership relationship. A tenant may eventually use multiple
physical MongoDB databases while presenting one logical tenant data space.
All tenant-scoped business decisions must be server-side:

`Authenticated Platform Identity → Tenant Membership → Trusted Tenant Context → Tenant Authorization (where required) → Subscription Entitlement (where required) → Business Service → Tenant Storage Resolver → Tenant Database Registry → Storage Placement/Routing Policy → MongoDB Connection Manager → Tenant Repository → Tenant Data`

Clients must never provide a database name or connection string. The Tenant
foundation does not add a tenant resolver implementation, MongoDB connection
modules, tenant data models, or provisioning.

Platform audit logs and security events are central-platform records stored in
the Prisma/MySQL database. They are platform-scoped, append-oriented, and keep
security-event resolution separate from the original event evidence. Their
metadata is constrained to safe scalar values; authentication credentials and
raw internal errors are never persisted.

## FUTURE / PLANNED — Thanarah AI Voice Receptionist

Thanarah may offer an optional paid AI voice receptionist add-on for healthcare
tenants. This is a long-term architectural direction only and is **not part of
the current implementation**.

### Tenant isolation and configuration

- Every call must have an explicit tenant context; no global receptionist may
  access multiple tenants' data.
- Each tenant must independently control its phone number, voice configuration,
  AI agent, approved knowledge and FAQs, allowed actions, business hours, and
  human-handoff behavior.
- Future call records, metadata, history, usage, and analytics must remain
  tenant-scoped.

Conceptually:

`Tenant → Phone Number → Voice Configuration → AI Agent → Knowledge / FAQs → Allowed Actions → Controlled Thanarah APIs → Call Record / Metadata`

### Capabilities and language

The agent should eventually support natural, conversational Saudi Arabic and
common healthcare and appointment terminology, while leaving room for Modern
Standard Arabic and English. Tenant-approved capabilities may include clinic
information, hours, location, services, doctors, availability, policies, FAQs,
appointment status, booking, rescheduling, cancellation, confirmation, and
escalation to staff.

### Safety and authorization boundary

- The voice agent must authenticate and authorize through the same application
  services used by web, mobile, staff dashboards, and APIs.
- It may call only tenant-enabled, controlled Thanarah APIs and must never
  receive unrestricted database access or execute arbitrary queries.
- Existing business rules must remain authoritative:
  `Voice AI → AppointmentService → AppointmentRepository`, never
  `Voice AI → database`.
- Voice AI must not become a parallel business-logic system.

### Provider-neutral telephony

No telephony or voice provider is selected. Future implementation must use
provider abstractions so providers can change without rewriting healthcare
domain logic:

`Phone Number → Telephony Provider → Voice Session → Speech Recognition → Thanarah Voice Agent → Tenant Context → Controlled Thanarah Services → Voice Response → Caller`

### Commercial model

The architecture must allow per-tenant enablement, plan and call-minute limits,
usage tracking, billing integration, overage handling, call history, analytics,
configurable business hours, and human handoff. Billing and usage tracking are
not implemented yet. A general PlanFeature quota-definition and decision
foundation exists, but authoritative call-minute usage and enforcement do not.

Do not add voice or telephony dependencies, database models or migrations,
authentication changes, APIs, or tests until a future implementation phase
explicitly authorizes that work.

## How to run on Replit

**Workflow:** `Start application` — runs `npx nest build && node dist/main`

The app serves on **port 5000** in development mode.

`DATABASE_URL` is intentionally absent on Replit. The app starts cleanly
without a live DB connection; `/health` remains successful while `/ready`
returns 503 until an approved non-production database is available. This is
expected development behavior. In production, `DATABASE_URL` is required and
startup fails if the central database connection cannot be established.

### Authentication configuration

`JWT_ACCESS_SECRET` signs access tokens and must contain at least 32 characters
in production. Set development-only values through Replit Secrets. The current
authentication foundation does not use `SESSION_SECRET`.

### Required in production (cPanel Node.js app environment only — never commit)

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | `mysql://USER:PASS@localhost:3306/thanarah_platform` |

### Non-secret env vars (already set)

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `development` |
| `PORT` | `5000` |
| `AUTH_ACCESS_TOKEN_TTL_MINUTES` | `15` |
| `AUTH_REFRESH_TOKEN_TTL_DAYS` | `30` |
| `THROTTLE_TTL` | `60000` |
| `THROTTLE_LIMIT` | `100` |

## Project structure

```
src/
├── main.ts              # Entry point — Fastify adapter, Swagger, static files
├── app.module.ts        # Root module
├── app.controller.ts    # Liveness (/health) and database readiness (/ready)
├── config/              # Env validation (Zod schema), ConfigService
├── database/            # PrismaService (mock-safe), DatabaseModule
├── tenant/              # Tenant, central membership, and future isolation contracts
├── platform-catalog/    # Central Plan and Feature definitions
├── subscriptions/       # Tenant-specific platform Subscription foundation
├── platform-security/   # Central audit-log and security-event repository/service
└── common/              # Shared constants, filters, interceptors, pipes
prisma/
├── schema.prisma        # Current central platform models and audit/security records
├── migrations/          # Versioned schema changes; authorization baseline data is migration-owned
public/                  # Static files — Coming Soon splash page + assets
```

## Key URLs (development)

- `/` — Coming Soon splash page (static)
- `/health` — process liveness; does not claim database availability
- `/ready` — central database readiness; returns 503 when unavailable
- `/docs` — Swagger UI

## Platform API and guard conventions

- Application APIs use `/api/v1/...`: `api` is the global prefix and controllers
  use the `v1` path segment. Do not add a competing versioning mechanism or
  `/api/v2` without an approved architecture change.
- Infrastructure routes remain unversioned and outside platform authentication:
  `/health`, `/ready`, and `/docs`. Health is liveness; readiness reports central
  database availability without exposing credentials or raw database errors.
- Public application routes are deliberately marked with `@Public()`.
  Protected application routes explicitly use `PlatformAuthGuard`; it is not a
  global authentication guard.
- Permission-protected routes use
  `@UseGuards(PlatformAuthGuard, PlatformAuthorizationGuard)` in that order and
  declare server-owned requirements with `@RequirePermissions(...)`.
- `PlatformAuthGuard` establishes the trusted user/session context.
  `PlatformAuthorizationGuard` separately resolves permissions server-side from
  that authenticated user. Authentication is not authorization.
- Never derive authentication or permissions from tenant hostnames, request
  bodies, query parameters, headers, cookies, or client-supplied role/permission
  IDs. Clients cannot choose `@RequirePermissions` values.

## Tenant foundation and isolation boundary

**Tenant identity, membership, and tenant authorization are implemented; tenant
data isolation is not operational yet.** Phase 14A adds the platform Tenant
record and administration endpoints. Phase 14B adds central TenantMembership
persistence, lifecycle operations, audit events, and membership administration
endpoints. Phase 14C adds trusted tenant context, tenant roles/permissions, and
the `TenantAuthorizationGuard`. There is no tenant-owned repository
implementation, database-registry record, tenant storage connection, or
tenant-facing business API.

- Platform administrators use `/api/v1/platform/tenants` to create, list, and
  inspect tenants, and `/api/v1/platform/tenants/:id/status` to change status.
  Reads require existing `platform.read`; mutations require existing
  `platform.manage`. The routes are authenticated and are not public.
- A tenant has a normalized unique slug, legal/display names, and the explicit
  `ACTIVE`, `SUSPENDED`, or `DEACTIVATED` lifecycle state. Deactivation is
  terminal. The slug and UUID identify a record; neither grants membership or
  authorization. `ACTIVE` may become `SUSPENDED` or `DEACTIVATED`;
  `SUSPENDED` may become `ACTIVE` or `DEACTIVATED`; a repeated status is an
  idempotent no-op.
- Tenant creation and lifecycle changes record the trusted authenticated actor
  and tenant subject in central platform audit records. Request bodies cannot
  supply the actor or initial lifecycle state.
- Membership is the explicit central-platform relationship
  `Platform User (User) → TenantMembership → Tenant`. A user has no tenant
  access merely because they are authenticated or know a tenant ID. Membership
  belongs in the central Prisma database, not tenant MongoDB.
- Membership creation is an administrative invitation and always starts in
  `INVITED`; delivery by email, SMS, or WhatsApp is not implemented. One
  membership row is allowed per tenant/platform-user pair, including after
  removal. `REMOVED` is terminal and cannot be reactivated or recreated in
  Phase 14B.
- Membership lifecycle transitions are explicit: `INVITED → ACTIVE` or
  `REMOVED`; `ACTIVE → SUSPENDED` or `REMOVED`; `SUSPENDED → ACTIVE` or
  `REMOVED`. Repeating the current transition is an idempotent no-op.
  Platform administrators cannot create or manage their own membership.
- Membership management routes are nested under
  `/api/v1/platform/tenants/:tenantId/memberships`. Reads require existing
  `platform.read`; invitations and lifecycle mutations require existing
  `platform.manage`. The tenant and membership IDs are always checked together
  for membership operations.
- The active-membership lookup requires both tenant ID and platform-user ID and
  returns true only for an `ACTIVE` row for that exact pair. It is a relationship
  check only: it does not authenticate users, create `TrustedTenantContext`, or
  authorize tenant operations. Tenant roles/permissions and the
  `TenantAuthorizationGuard` are implemented separately in Phase 14C.
- Invitation, activation, suspension, and removal write central audit events
  with actor, platform-user subject, and tenant subject. Actor identity comes
  only from authenticated server context; request bodies cannot choose actors,
  statuses, tenant roles, or permissions.
- The versioned Prisma migration is present but has not been applied to
  production. No production database was used for Phase 14A or 14B.

- A tenant ID supplied by a caller is only a selection candidate. A future
  server-side membership validator must verify that the authenticated platform
  user belongs to that tenant against trusted platform data before a
  `TrustedTenantContext` can be created. An opaque ID or hostname alone grants no
  access; platform role IDs or token claims are not tenant membership.
- The context keeps platform user, tenant, and membership identities distinct.
  Tenant authorization remains separate from platform authentication and from
  subscription/feature entitlement. A valid tenant member is not automatically
  entitled to every feature.
- The generic tenant repository contract requires `TrustedTenantContext`; the
  current Tenant identity repository is platform-scoped, not a tenant-owned
  data repository. There is no default tenant or global-database fallback.
  Future tenant-owned implementations must scope every query with trusted
  context so one tenant's context cannot access another tenant's records.
- `TenantStorageResolver` and `TenantDatabaseRegistry` both require trusted
  context. Storage routes contain one or more opaque registry-owned placements
  to allow future multi-database tenants; clients never supply physical
  database identifiers or connection strings.
- Missing or invalid context fails closed with stable
  `TENANT_CONTEXT_REQUIRED` or `TENANT_CONTEXT_INVALID` errors. An empty storage
  route is invalid; it must not fall back to platform/global data.
- Facility and branch scope is subordinate:
  `Platform → Tenant/Organization → Facility → Branch → Business resources`.
  Tenant is not a facility; a facility or branch ID cannot replace tenant
  authorization or widen tenant scope.
- Platform storage is reserved for platform identities, authentication,
  sessions, roles/permissions, current tenant identity/lifecycle and membership
  metadata, the platform-level SaaS Plan/Feature catalog and Subscription
  assignments, future database-registry metadata, and platform audit/security records. Future
  tenant MongoDB storage is for tenant operational/healthcare data such as
  patients, doctors, staff, departments/specialties, scheduling/appointments/
  visits, medical records/clinical notes/prescriptions, documents, billing/
  insurance, and notifications. These persistence boundaries are architectural
  only; no tenant-owned operational or healthcare data models are added here.
- Plans and Feature definitions are reusable central-platform metadata, not
  tenant-owned permissions. Subscription is a Tenant-specific assignment to a
  reusable Plan, stored centrally with retained history. Creating one requires
  an active Tenant and active Plan; later Plan lifecycle changes do not rewrite
  existing assignments.
- The platform-only subscription API is
  `/api/v1/platform/subscriptions`. Reads require `subscriptions.read`;
  mutations require `subscriptions.manage`. It does not use
  `TenantAuthorizationGuard` and exposes no tenant-facing subscription route.
  `ACTIVE`, `SUSPENDED`, `CANCELLED`, and `EXPIRED` are persisted states;
  `SCHEDULED` and date-derived `EXPIRED` are effective read states. Periods are
  UTC and end-exclusive, and history is never physically deleted.
- Only one effective subscription period may exist for a Tenant. Create and
  lifecycle writes lock the central Tenant row in a `READ COMMITTED` transaction
  before checking overlap, serializing competing writes. Reads fail closed on
  contradictory current records. Explicit expiration exists; there is no
  expiration/renewal job.
- Tenant entitlement is a separate runtime decision. The non-global
  `TenantEntitlementGuard` reads server-defined `@RequireTenantFeature(...)`
  metadata and resolves only from a well-formed `TrustedTenantContext`, the
  Phase 16 current-Subscription service, an active Plan, an enabled PlanFeature,
  and an active Feature. No current Subscription, historical fallback,
  inactive/archived Plan, inactive Feature, or disabled/missing relationship
  grants entitlement.
- Entitlement does not replace tenant permission checks. A future business
  route must compose `TenantAuthorizationGuard` with
  `TenantEntitlementGuard`; neither guard is global. Existing business routes
  are not entitlement-gated, and there is no public arbitrary
  Tenant/Feature-check endpoint. Denials use the generic `FEATURE_NOT_INCLUDED`
  response; checks are not audited individually and no cache is used.
- Entitlement is runtime-only: no `TenantEntitlement` table, usage counters,
  usage metering, business-route quota enforcement, billing, payments, invoices,
  trials, renewals, upgrades, or downgrades. Any future entitlement cache must
  be invalidated on Subscription, Plan, PlanFeature, and Feature changes.
  Migrations are versioned but are not applied automatically at startup.
- Phase 18 adds validated `PlanFeature.quotaLimits` definitions and a
  `TenantQuotaService` decision contract. Server-defined resource keys are
  separate from Feature keys; the service always verifies entitlement first.
  `currentUsage` is validated decision input only, not authoritative usage, and
  is never accepted from a business-route client. There is no trusted usage
  source yet, so no quota guard is registered and no existing business route is
  quota-enforced. No counters, events, metering, cache, workers, or billing are
  added. The Phase 18 migration is versioned but has not been applied.
- Phase 19 adds only central-platform tenant staff profiles linked to existing
  active memberships and platform users. It does not add authentication
  identities, roles, clinical staff data, healthcare/business modules, or
  MongoDB data. Staff access uses tenant permissions and the trusted tenant
  context; the Phase 19 migration is versioned but has not been applied.
- Phase 20 adds tenant-wide role assignments to existing staff and tenant
  roles. Membership role grants remain an explicit authorization source;
  active staff-role grants are resolved additively through the existing tenant
  authorization service. Suspended/deactivated staff profiles fail closed.
  OWNER assignment remains owner-only and OWNER assignments cannot be removed
  through ordinary role management. No facility/branch role scope is added;
  the Phase 20 migration is versioned but has not been applied.
- Preserve `Controller → Service/Policy → Repository → Infrastructure`.
  Controllers and request channels must never select physical tenant storage.

## Prisma workflow

```bash
npx prisma format                         # format the schema
npx prisma generate                       # regenerate the Prisma client
npx prisma migrate dev --name <name>      # approved non-production database only
npx prisma migrate deploy                 # production execution from the cPanel environment
```

The repository has no Prisma seed workflow. Required authorization baseline
data is embedded in versioned migrations. Never point Replit at the production
cPanel database; production migration execution and `DATABASE_URL`
configuration belong to the cPanel environment.

## cPanel deployment notes

- Set `DATABASE_URL`, `JWT_ACCESS_SECRET`, `AUTH_TRUSTED_PROXIES`, and `NODE_ENV=production` in the cPanel Node.js application environment.
- Database host is `localhost` on cPanel.
- Run `npx prisma migrate deploy` from the approved cPanel production environment for deployments that include new migrations.
- The `prepare` script uses `husky || true` to prevent build failures in CI/production.
- `JWT_ACCESS_SECRET` must be at least 32 characters in production — deployment exits immediately if it is missing or too short.

## User preferences

_None recorded yet._
