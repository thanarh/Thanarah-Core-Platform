# Development Database Connectivity Report

**Date:** 2026-10-27

> This was the initial diagnostic. The configuration alignment work and latest
> verification are documented in
> `PHASE_57_DATABASE_CONFIGURATION_REPORT.md`.

## Root cause

The configured development secret exists, but the running application classifies
its value as `not-mysql`. The value was not read or printed. The development
connection policy only accepts a safe `mysql://` URL whose database name
identifies a development/test target and whose host is not production-like.
Because this validation fails, the application does not attempt a database
connection.

This matches the observed health results: `/health` returns 200 while `/ready`
returns 503 with `DATABASE_UNAVAILABLE`.

## Configuration contract

| Component | Development configuration | Other environments |
| --- | --- | --- |
| Nest application startup and readiness | `MYSQL_DATABASE_URL`, after development-target validation | `DATABASE_URL` |
| Prisma schema / Prisma CLI | Schema declares the MySQL provider and reads `DATABASE_URL` | `DATABASE_URL` |
| `bootstrap:platform-admin:dev` | Reads `MYSQL_DATABASE_URL`, validates it, then explicitly overrides the Prisma datasource URL | Not permitted outside `NODE_ENV=development` |

The Nest application's Prisma service explicitly supplies its selected URL to
the Prisma client, so runtime startup and readiness use the validated
development variable. The bootstrap script also supplies that variable
directly. However, Prisma CLI commands use the schema's `DATABASE_URL`; there
is no development migration wrapper that safely maps the development secret
to that variable. Replit's managed PostgreSQL `DATABASE_URL` must not be used
for this MySQL project or repurposed as a MySQL URL.

## Changes and safety

The project already has separate development URL selection and safety checks,
plus tests covering URL classification and environment selection. No automatic
URL conversion or compatibility alias was added: converting a non-MySQL URL
could disguise a PostgreSQL target and risk connecting to the wrong database.
No production configuration was inspected or changed.

## Verification

- Development secret presence: confirmed; secret contents were not accessed.
- Startup classification: `not-mysql`; connection was rejected before any
  database connection attempt.
- `/health`: HTTP 200.
- `/ready`: HTTP 503, `DATABASE_UNAVAILABLE`.
- Targeted configuration and readiness tests: 17 passed.
- TypeScript check and Nest build: passed.
- Lint: passed with one existing warning in
  `test/encounter-operation-reconciliation.spec.ts` about a missing return
  type; no lint errors.
- Bootstrap shell syntax check and `git diff --check`: passed.

## Authentication and remaining blocker

Authentication was not tested. No administrator lookup, bootstrap, password
reset, database migration, or database write was performed.

The required external action is to update the Replit development secret
`MYSQL_DATABASE_URL` to a valid isolated MySQL/MariaDB development connection
URL. Its scheme must be `mysql://`, its database name must clearly identify a
development/test target, and its host must not be production-like. Do not paste
the connection string into chat. After the secret is corrected, restart the
application and recheck readiness before attempting any authorized sign-in.
