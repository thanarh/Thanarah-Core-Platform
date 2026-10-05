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
context. Subscription entitlements are separate and are not implemented here.

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

## Facility Foundation

The hierarchy is `Tenant / Organization → Facility → Future Branch`. A tenant
can have multiple Facilities, and every Facility belongs to exactly one tenant.
Facilities are central-platform metadata stored in MySQL/MariaDB; they are not
Branches or healthcare records and do not create tenant databases.

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
not physically deleted. Branch, staff, healthcare operations, subscriptions
and entitlements, and MongoDB/tenant-database provisioning remain future
phases.

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
