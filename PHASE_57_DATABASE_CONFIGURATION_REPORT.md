# Phase 57 — Database Configuration Alignment Report

**Date:** 2026-10-28

## Configuration contract

- `src/config/database-url-policy.ts` is the shared selector and safety policy.
- In development, application startup/readiness, the Prisma development CLI
  wrapper, and the development admin bootstrap all select only a validated
  `MYSQL_DATABASE_URL`.
- The Replit-managed non-MySQL `DATABASE_URL` is never used as the development
  central database. If both variables contain MySQL URLs, they must identify
  the same host, port, and database or development operations fail closed.
- Outside development, the application continues to use `DATABASE_URL`.
- `prisma/schema.prisma` retains the MySQL provider and `DATABASE_URL` contract.
  `scripts/prisma-dev.cjs` applies the shared selection and passes the validated
  development URL as `DATABASE_URL` only to its child Prisma CLI process.
- Use `npm run prisma:dev -- <prisma arguments>` for development Prisma CLI
  commands. The wrapper builds the shared policy first. The admin bootstrap
  command also builds first and uses that same policy.

No schema/provider rewrite, automatic URL conversion, migration, production
access, database write, or administrator creation was performed.

## Changes

- Centralized development and non-development database URL selection and
  conflicting MySQL target checks.
- Added a guarded Prisma development CLI wrapper and routed the documented
  development bootstrap command through the shared policy.
- Documented the supported development CLI entry point and added tests for
  PostgreSQL isolation, conflicting MySQL URLs, and production URL selection.

## Verification

- Configuration and readiness tests: **20 passed**.
- TypeScript check and Nest build: passed.
- Lint: no errors; one existing warning remains in
  `test/encounter-operation-reconciliation.spec.ts` for a missing return type.
- Bootstrap shell syntax, both Node script syntax checks, and
  `git diff --check`: passed.
- `npm run prisma:dev -- --version` succeeded using synthetic test URLs. It
  ran only the CLI version command; it did not connect to a database.
- Application restarted successfully. Startup classified the configured
  development URL as `not-mysql` and rejected the connection before attempting
  database access.
- `/health`: HTTP 200.
- `/ready`: HTTP 503, `DATABASE_UNAVAILABLE`.

## Authentication and remaining blocker

No real MySQL/MariaDB connection was established, and administrator
authentication was not tested. The development secret is present, but its value
was not accessed; runtime validation continues to report `not-mysql`.

Update the Replit development secret `MYSQL_DATABASE_URL` to a valid isolated
MySQL/MariaDB development URL using the `mysql://` scheme. The database name
must clearly identify a development/test target, and the host must not be
production-like. Then restart the application and verify `/ready` before any
authorized sign-in test. Do not paste the URL into chat.
