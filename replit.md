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
| **Thanarah Central Platform** | Prisma 6 | MySQL / MariaDB on cPanel | Global identities, authentication, sessions, roles, permissions, and other platform metadata |
| **Tenant Healthcare and Operations** | Not selected yet | Isolated MongoDB database(s) per tenant (future) | Tenant-owned healthcare and operational data |

Tenant MongoDB is permanent architecture but **not yet implemented**. A tenant
may eventually use multiple physical MongoDB databases while presenting one
logical tenant data space. Future resolution must be server-side:

`Authenticated Platform Identity → Tenant Membership → Trusted Tenant Context → Tenant Authorization → Subscription Entitlement → Tenant Storage Resolver → Tenant Database Registry → Storage Placement/Routing Policy → MongoDB Connection Manager → Tenant Repository → Tenant Data`

Clients must never provide a database name or connection string. Correction 6
adds type contracts only; it does not add a tenant resolver implementation,
MongoDB connection modules, models, or provisioning.

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
not implemented yet.

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
├── tenant/              # Future tenant isolation contracts only
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

## Tenant isolation contract — future architecture only

**Tenant isolation is not operational yet.** There are no tenant endpoints,
membership persistence, tenant-owned repository implementations,
database-registry records, or tenant storage connections in this correction.

- A tenant ID supplied by a caller is only a selection candidate. A future
  server-side membership validator must verify that the authenticated platform
  user belongs to that tenant against trusted platform data before a
  `TrustedTenantContext` can be created. An opaque ID or hostname alone grants no
  access; platform role IDs or token claims are not tenant membership.
- The context keeps platform user, tenant, and membership identities distinct.
  Tenant authorization remains separate from platform authentication and from
  subscription/feature entitlement. A valid tenant member is not automatically
  entitled to every feature.
- Tenant-owned repository methods require `TrustedTenantContext`; there is no
  unscoped lookup, default tenant, or global-database fallback in the contract.
  Implementations must scope every query with that context so one tenant's
  context cannot access another tenant's records.
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
  sessions, roles/permissions, future tenant and subscription metadata,
  database-registry metadata, and platform audit/security records. Future
  tenant MongoDB storage is for tenant operational/healthcare data such as
  patients, doctors, staff, departments/specialties, scheduling/appointments/
  visits, medical records/clinical notes/prescriptions, documents, billing/
  insurance, and notifications. These persistence boundaries are architectural
  only; no tenant data models are added here.
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
