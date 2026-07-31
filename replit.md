# Thanarah Core Platform

Enterprise healthcare SaaS backend — NestJS 11 + Fastify + MongoDB, targeting Saudi Arabia and the wider region.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Framework | NestJS 11 + Fastify 5 |
| Database | MongoDB via Mongoose |
| Language | TypeScript 5 (strict) |
| Validation | Zod |
| API Docs | Swagger / OpenAPI at `/api-docs` |
| Testing | Vitest |

## How to run on Replit

**Workflow:** `Start application` — runs `npx nest build && node dist/main`

The app serves on **port 5000** in development mode.

### Required secrets (set via Replit Secrets)

| Secret | Description |
|--------|-------------|
| `MONGO_URI` | MongoDB connection string (Atlas or self-hosted) |
| `JWT_SECRET` | JWT signing secret — minimum 32 characters |
| `SESSION_SECRET` | Session signing secret — already configured ✅ |

### Non-secret env vars (already set)

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `development` |
| `PORT` | `5000` |

### Optional env vars (have defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `THROTTLE_TTL` | `60000` | Rate limit window (ms) |
| `THROTTLE_LIMIT` | `100` | Max requests per window |

## Project structure

```
src/
├── main.ts              # Entry point — Fastify adapter, Swagger, static files
├── app.module.ts        # Root module
├── app.controller.ts    # Health check route (/health)
├── config/              # Env validation (Zod schema), ConfigService
├── database/            # Mongoose connection module
└── common/              # Shared constants, utilities
public/                  # Static files — Coming Soon splash page + assets
```

## Key URLs (development)

- `/` — Coming Soon splash page (static)
- `/health` — Health check endpoint
- `/api-docs` — Swagger UI

## Render deployment notes

- The `prepare` script uses `husky || true` to prevent build failures in CI/production where git hooks are unnecessary.
- Set `NODE_ENV` to `development`, `staging`, or `production` — other values will fail env validation.
- `JWT_SECRET` is required with no default; deployment will exit immediately if missing.

## User preferences

_None recorded yet._
