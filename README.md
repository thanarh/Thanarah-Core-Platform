<div align="center">
  <img src="public/assets/logo-full.png" alt="Thanarah Logo" width="340" />

  <br/>

  # ثناره — Thanarah Core Platform

  **منصة SaaS صحية للمؤسسات — Enterprise Healthcare SaaS**

  [![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs)](https://nestjs.com)
  [![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square&logo=fastify)](https://fastify.dev)
  [![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
  [![License](https://img.shields.io/badge/License-Private-lightgrey?style=flat-square)](#)

</div>

---

## 🌿 من نحن — About Us

**ثناره** منصة رقمية متكاملة لإدارة المؤسسات الصحية، تجمع بين كفاءة العمليات وجودة تجربة المستخدم لخدمة مرافق الرعاية الصحية في المملكة العربية السعودية والمنطقة.

**Thanarah** is an enterprise-grade healthcare SaaS platform designed to unify clinical, operational, and administrative workflows for healthcare organizations across Saudi Arabia and the wider region. We combine cutting-edge technology with deep domain expertise to deliver a seamless experience for healthcare providers and patients alike.

---

## 🏗️ المكدس التقني — Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js 22 |
| **Framework** | NestJS 11 + Fastify |
| **Central persistence** | Prisma 6 + MySQL/MariaDB |
| **Tenant persistence** | Isolated MongoDB database(s) per tenant — planned, not implemented |
| **Language** | TypeScript 5 (strict) |
| **Validation** | Zod |
| **API Docs** | Swagger / OpenAPI |
| **Testing** | Vitest |

---

## 🚀 تشغيل المشروع — Getting Started

## Persistence Architecture

Thanarah uses two permanent, distinct persistence systems:

- **Central platform:** Prisma 6 with MySQL/MariaDB stores global identities,
  authentication, sessions, platform roles and permissions, and other
  platform-level metadata.
- **Tenant data:** isolated MongoDB database(s) will store each tenant's
  healthcare and operational data. This layer is planned and **not yet
  implemented**. A tenant may eventually span multiple physical MongoDB
  databases while remaining one logical tenant data space.

Future tenant storage will be resolved only on the server through trusted
tenant context and a central tenant database registry. Clients must never
select a database name or provide a connection string. MongoDB must not be
introduced into the current platform foundation before that design is
explicitly implemented.

## Authorization Model and Runtime

Thanarah keeps platform and tenant authorization separate:

- **Platform:** `PlatformUser → PlatformRole → PlatformPermission`
- **Tenant:** `PlatformUser → TenantMembership → TenantRole → TenantPermission`

Tenant permissions are central, globally defined catalog entries in the
`tenant.*` namespace. Tenant roles and their permission assignments belong to
one tenant; the same role code may exist in another tenant without sharing
assignments. Tenant permissions cannot grant platform permissions, and
platform permissions do not grant tenant permissions.

Membership establishes a user's relationship to a tenant; it does not itself
authorize tenant operations. A tenant ID selects a possible scope; it is not a
permission. Tenant authorization requires a server-validated active membership,
trusted tenant context, and the permissions resolved from that membership's
tenant role assignments. The runtime chain is:

`Platform Authentication → Trusted Tenant Context → Active Tenant Membership → Tenant Role(s) → Tenant Permission(s) → Tenant Authorization Decision → Business Operation`

For tenant role APIs, `PlatformAuthGuard` authenticates the platform user.
`TenantContextGuard` treats the route's `:tenantId` only as a lookup input,
checks the tenant and that authenticated user's active membership, and creates
`TrustedTenantContext` only after validation. `TenantAuthorizationGuard` verifies
that the authenticated user and route tenant match that context, then resolves
the required permission from server-defined route metadata and central
database-backed tenant role assignments. Request headers, query parameters,
cookies, and body fields cannot supply tenant roles or permissions.

Only `ACTIVE` tenants and `ACTIVE` memberships proceed to tenant authorization.
`SUSPENDED` and `DEACTIVATED` tenants, and `INVITED`, `SUSPENDED`, or `REMOVED`
memberships, are denied normal tenant operations. Missing or invalid platform
authentication returns 401; an authenticated user without a usable membership
or required tenant permission receives 403. Tenant lookup and membership
failures use the same safe authorization response so tenant existence is not
disclosed. Cross-tenant requests fail closed.

Tenant authorization is applied only to explicitly protected tenant routes; it
is not a global guard. `/health`, `/ready`, `/docs`, and public login/refresh
routes remain outside tenant authorization. The initial-owner bootstrap route
uses platform authorization only. Missing-tenant-permission denials are recorded
by the existing platform audit service using the trusted actor and tenant
context. Platform-level Plan, Feature, and Subscription definitions are separate
from tenant authorization. Runtime entitlement resolution is not implemented.

Each tenant receives the minimal `OWNER`, `ADMIN`, and `MEMBER` defaults through
a platform-managed bootstrap operation. The initial owner must be a different,
active tenant member selected by an authenticated platform administrator with
`platform.manage`. An existing tenant owner can assign ownership to another
active member, but cannot assign it to themselves. Owner assignments cannot be
removed, and an owner membership cannot be suspended or removed through the
current membership lifecycle API. Owner transfer and removal require a future
explicit workflow. Tenant `OWNER` is not Platform `OWNER`.

Tenant role routes use `/api/v1/tenants/:tenantId/...` and require platform
authentication, active membership validation, trusted tenant context, and an
explicit tenant permission. The initial-owner bootstrap route is
`/api/v1/platform/tenants/:tenantId/roles/bootstrap` and uses platform
authorization only.

## SaaS Plan and Feature Foundation

Plans and Features are reusable, platform-level catalog definitions stored in
the central Prisma/MySQL database. Neither record has a `tenantId`; no tenant
owns or manages catalog entries. Tenant-specific Subscription records reference
these reusable Plans.

**Authorization ≠ Entitlement. Plan ≠ Subscription. Feature ≠ Permission.**

The two flows remain separate:

`User → Tenant Membership → Tenant Permission`

`Tenant → Subscription → Plan → PlanFeature → Feature`

Authorization and commercial entitlement are separate:

- **Tenant Permission** answers whether an authenticated tenant member may
  perform an operation.
- **Feature entitlement** answers whether a tenant's future commercial
  assignment allows a capability.
- A future business operation requires both checks. A Plan including a Feature
  does not authorize every member, and a member's permission does not grant a
  capability excluded from the tenant's commercial assignment.

`Feature` is not a tenant permission. This phase defines catalog records only;
it does not resolve tenant entitlements or gate business operations.

Plan keys and Feature keys are normalized, unique, and immutable after creation.
Names and descriptions are presentation metadata. Plan lifecycle is `ACTIVE`,
`INACTIVE`, or terminal `ARCHIVED`; Feature lifecycle is `ACTIVE` or `INACTIVE`.
Only active Plans may have their Feature associations changed, and only active
Features may be newly attached or enabled. Deactivating a Feature preserves its
existing Plan associations. Plan and Feature records have no physical-delete
API.

`PlanFeature` is the normalized Plan-to-Feature relationship. It has a controlled
`enabled` flag and no arbitrary client-supplied configuration or usage limits.
It is a catalog definition, not a quota counter or runtime enforcement engine.
An explicit relationship-removal endpoint removes only that association, not
either catalog record.

Platform APIs are:

- `/api/v1/platform/plans` — create, list, inspect, update metadata, change
  lifecycle, and manage Plan Features.
- `/api/v1/platform/features` — create, list, inspect, update metadata, and
  activate/deactivate Feature definitions.

These routes use `PlatformAuthGuard` followed by
`PlatformAuthorizationGuard`, with the dedicated `plans.*`, `features.*`, and
`plan_features.manage` permissions. Tenant permissions cannot substitute for
platform permissions. The baseline grants catalog administration to platform
`OWNER`, `SUPER_ADMIN`, and `PLATFORM_ADMIN`; `SECURITY_ADMIN` and `SUPPORT_ADMIN`
do not receive these catalog-management permissions.

This catalog phase adds no pricing, currency, billing, payment, trial, renewal,
usage-metering, quota-enforcement, or healthcare records.

## SaaS Subscription Foundation

`Tenant → Subscription → Plan → PlanFeature → Feature` is the central-platform
commercial assignment relationship. Subscription records live in Prisma/MySQL;
they are platform SaaS metadata, not tenant healthcare data. Plans remain
reusable and do not acquire a `tenantId`.

Persisted Subscription lifecycle states are `ACTIVE`, `SUSPENDED`, `CANCELLED`,
and `EXPIRED`. The read-only `effectiveStatus` is date-aware and may report
`SCHEDULED` for a future start or `EXPIRED` for an elapsed end without silently
mutating the stored record. UTC `startsAt` is required, `endsAt` is nullable for
open-ended periods, and period ends are exclusive. `cancelledAt` is set only by
explicit cancellation. Historical rows are retained.

`TRIALING` is omitted because this phase defines no trial workflow; `PAST_DUE`
is omitted because billing is out of scope. A new assignment is stored as
`ACTIVE`, unless its period has already ended, in which case it is stored as
`EXPIRED`. A future start remains stored as `ACTIVE` but reads as `SCHEDULED`.
`ACTIVE` may transition to `SUSPENDED` or `CANCELLED`; `SUSPENDED` may transition
to `ACTIVE` or `CANCELLED`. Reactivation requires an active Tenant and an
unended period. `ACTIVE` or `SUSPENDED` may transition to `EXPIRED` only after a
non-null end date has passed. Cancellation is allowed only after the start and
before the end, if present. `CANCELLED` and `EXPIRED` are terminal states;
repeated or invalid transitions are rejected.

The current effective Subscription is an `ACTIVE` row where
`startsAt <= now < endsAt`, or where `endsAt` is null. The system rejects
overlapping `ACTIVE` periods per Tenant and fails closed if a read finds more
than one current row. Creates and lifecycle transitions lock the central Tenant
row inside a MySQL `READ COMMITTED` transaction before checking or changing
periods. This serializes competing writes for that Tenant. There is no database
partial unique index for time ranges.

Creating a Subscription requires an `ACTIVE` Tenant and an `ACTIVE` Plan.
Later Tenant or Plan lifecycle changes do not delete or rewrite existing
history. Only platform administrators can read or manage subscriptions in this
phase; no tenant-facing subscription endpoint is exposed. Required platform
permissions are `subscriptions.read` and `subscriptions.manage`; the baseline
grants them to `OWNER`, `SUPER_ADMIN`, and `PLATFORM_ADMIN`.

Platform endpoints:

- `/api/v1/platform/subscriptions` — create and list.
- `/api/v1/platform/subscriptions/current?tenantId=...` — resolve the current
  effective row for one Tenant; returns `null` when none exists.
- `/api/v1/platform/subscriptions/:subscriptionId` — read history by ID.
- `/api/v1/platform/subscriptions/:subscriptionId/activate`
- `/api/v1/platform/subscriptions/:subscriptionId/suspend`
- `/api/v1/platform/subscriptions/:subscriptionId/cancel`
- `/api/v1/platform/subscriptions/:subscriptionId/expire` — explicit lifecycle
  transition only; no scheduled expiry worker exists.

Create and lifecycle operations use the central `PlatformAuditLog` with trusted
actor/session context, tenant subject, and safe identifiers/statuses. The
versioned Prisma migration is present but has not been applied by this
implementation.

**Authorization ≠ Subscription ≠ Entitlement ≠ Usage.** Authorization answers
whether a user may perform an operation. Subscription records which commercial
Plan is assigned to a Tenant. Entitlement resolution and runtime gating are
future work, as are billing, payments, invoices, usage metering, quotas,
automatic renewals, upgrade/downgrade workflows, trials, and payment providers.

## Facility Foundation

The hierarchy is `Tenant / Organization → Facility → Branch`. A tenant can
have multiple Facilities, and every Facility belongs to exactly one tenant.
Facilities and Branches are central-platform metadata stored in MySQL/MariaDB;
they are not healthcare records and do not create tenant databases.

Tenant Facility routes use
`/api/v1/tenants/:tenantId/facilities[/.../:facilityId]`. They reuse platform
authentication, trusted tenant context, and tenant permission checks. The route
tenant ID only selects the context; repository operations use the tenant ID
from that trusted context. Facility permissions use the `tenant.facilities.*`
namespace and are resolved from central tenant role assignments. The default
OWNER can perform all Facility operations; ADMIN can create, update, suspend,
and activate Facilities; MEMBER has read access. Deactivation is OWNER-only.

Facilities support create, list, read, name update, and explicit suspend,
activate, and deactivate operations. Deactivation is terminal; Facilities are
not physically deleted.

## Branch Foundation

A Facility can have multiple Branches; each Branch belongs to exactly one
Facility and derives its tenant through `Branch → Facility → Tenant`. Branch
routes are nested under both the tenant and facility:
`/api/v1/tenants/:tenantId/facilities/:facilityId/branches[/.../:branchId]`.
Tenant context is established first, the Facility is looked up within that
trusted tenant, and every Branch query verifies the Facility → Branch
relationship. Branches cannot be moved between Facilities through normal
updates.

Branch operations require an active Tenant and active parent Facility. A
suspended or deactivated Facility blocks normal Branch operations; an
unavailable Tenant is rejected by tenant-context validation. Branch lifecycle
uses `ACTIVE`, `SUSPENDED`, and terminal `DEACTIVATED` states, with no physical
delete route. Tenant permissions use `tenant.branches.*`; there is no
facility-level or branch-level RBAC.

Branches remain central platform metadata. They do not create MongoDB
databases or represent healthcare records. Staff, Doctors, healthcare
operations, entitlements, and MongoDB/tenant-database provisioning remain
future phases.

Production runs on **cPanel**:

`cPanel → Thanarah Node.js application → central Prisma/MySQL/MariaDB database`

### المتطلبات — Prerequisites

- Node.js 22+

### التثبيت — Installation

```bash
# Clone the repository
git clone https://github.com/thanarh/Thanarah-Core-Platform.git
cd Thanarah-Core-Platform

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# For local/Replit development, leave DATABASE_URL empty unless using an
# approved non-production MySQL/MariaDB database.

# Build and run
npx nest build && node dist/main
```

### متغيرات البيئة — Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Central MySQL/MariaDB connection; production value belongs only in cPanel | Production |
| `JWT_ACCESS_SECRET` | Access-token signing secret (minimum 32 characters in production) | ✅ |
| `AUTH_ACCESS_TOKEN_TTL_MINUTES` | Access-token lifetime in minutes (default: 15) | — |
| `AUTH_REFRESH_TOKEN_TTL_DAYS` | Refresh/session lifetime in days (default: 30) | — |
| `PORT` | Server port (default: 5000) | — |
| `NODE_ENV` | `development` or `production` | — |

Replit development must never connect to the production cPanel database.
Production database configuration belongs exclusively to the cPanel
environment.

---

## 📁 هيكل المشروع — Project Structure

```
Thanarah-Core-Platform/
├── src/
│   ├── main.ts              # Entry point
│   ├── app.module.ts        # Root module
│   └── ...                  # Feature modules
├── public/
│   ├── index.html           # Coming Soon splash page
│   └── assets/              # Logo and static assets
├── test/                    # E2E tests
└── README.md
```

---

## 🗺️ خارطة الطريق — Roadmap

- [x] Project scaffold — NestJS + Fastify
- [x] Central Prisma 6 + MySQL/MariaDB persistence foundation
- [x] Platform authentication, sessions, login, refresh, and logout foundation
- [x] Platform role and permission authorization foundation
- [x] Tenant organization, membership, and tenant role/permission foundations
- [x] Coming Soon splash page (Arabic typewriter effect)
- [ ] Tenant database registry and trusted server-side storage resolution
- [ ] Isolated tenant MongoDB database(s) — planned, not implemented
- [ ] Login page — bilingual (AR/EN)
- [ ] Dashboard — multi-tenant healthcare management
- [x] API documentation — Swagger

---

## 🤝 المساهمة — Contributing

هذا مستودع خاص. التطوير مقيّد على الفريق الأساسي.

This is a private repository. Contributions are restricted to the core team.

---

<div align="center">
  <sub>صُنع بعناية في المملكة العربية السعودية 🇸🇦 — Built with care in Saudi Arabia</sub>
</div>
