# Thanarah Core Platform

Enterprise healthcare SaaS backend — NestJS 11 + Fastify + MySQL/MariaDB (Prisma), targeting Saudi Arabia and the wider region.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Framework | NestJS 11 + Fastify 5 |
| Database | MySQL / MariaDB on cPanel — via Prisma 6 |
| Language | TypeScript 5 (strict) |
| Validation | Zod |
| API Docs | Swagger / OpenAPI at `/docs` |
| Testing | Vitest |

## Architecture — two persistence systems (never mixed)

| System | ORM | Database | Scope |
|--------|-----|----------|-------|
| **Thanarah Central Platform** | Prisma 6 | MySQL / MariaDB — `thanarah_platform` on cPanel | Users, roles, permissions |
| **Customer Medical Environments** | Mongoose (future) | Per-customer MongoDB (provisioned later) | Clinical / medical data |

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

`DATABASE_URL` is intentionally absent on Replit. The app starts cleanly without a live DB connection — `PrismaService.isConnected()` returns `false` and a warning is logged. This is expected development behaviour.

### Required secrets (set via Replit Secrets)

| Secret | Description |
|--------|-------------|
| `JWT_ACCESS_SECRET` | Access-token signing secret — minimum 32 characters in production |
| `SESSION_SECRET` | Session signing secret — already configured ✅ |

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
├── app.controller.ts    # Health check route (/health)
├── config/              # Env validation (Zod schema), ConfigService
├── database/            # PrismaService (mock-safe), DatabaseModule
└── common/              # Shared constants, filters, interceptors, pipes
prisma/
├── schema.prisma        # Prisma 6 schema — datasource + generator only (no models yet)
public/                  # Static files — Coming Soon splash page + assets
```

## Key URLs (development)

- `/` — Coming Soon splash page (static)
- `/health` — Health check endpoint
- `/docs` — Swagger UI

## Prisma workflow

```bash
# After adding models to prisma/schema.prisma:
npx prisma generate                        # regenerate client
npx prisma migrate dev --name <name>       # create + apply migration (needs DATABASE_URL)
npx prisma db seed                         # run seed (needs DATABASE_URL)
npx prisma migrate deploy                  # apply migrations in production (cPanel)
```

Migrations require a live `DATABASE_URL`. On Replit, set it temporarily via Replit Secrets when running migration commands, then remove it. Never commit credentials.

## cPanel deployment notes

- Set `DATABASE_URL`, `JWT_ACCESS_SECRET`, `SESSION_SECRET`, and `NODE_ENV=production` in the cPanel Node.js application environment.
- Database host is `localhost` on cPanel.
- Run `npx prisma migrate deploy` and `npx prisma db seed` after each deployment that includes new migrations.
- The `prepare` script uses `husky || true` to prevent build failures in CI/production.
- `JWT_ACCESS_SECRET` must be at least 32 characters in production — deployment exits immediately if it is missing or too short.

## User preferences

_None recorded yet._
