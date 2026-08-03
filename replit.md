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

## How to run on Replit

**Workflow:** `Start application` — runs `npx nest build && node dist/main`

The app serves on **port 5000** in development mode.

`DATABASE_URL` is intentionally absent on Replit. The app starts cleanly without a live DB connection — `PrismaService.isConnected()` returns `false` and a warning is logged. This is expected development behaviour.

### Required secrets (set via Replit Secrets)

| Secret | Description |
|--------|-------------|
| `JWT_SECRET` | JWT signing secret — minimum 32 characters (already set as env var) |
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
| `JWT_EXPIRES_IN` | `7d` |
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

- Set `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, and `NODE_ENV=production` in the cPanel Node.js application environment.
- Database host is `localhost` on cPanel.
- Run `npx prisma migrate deploy` and `npx prisma db seed` after each deployment that includes new migrations.
- The `prepare` script uses `husky || true` to prevent build failures in CI/production.
- `JWT_SECRET` is required with no default — deployment will exit immediately if missing.

## User preferences

_None recorded yet._
