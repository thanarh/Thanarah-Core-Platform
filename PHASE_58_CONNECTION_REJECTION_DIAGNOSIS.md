# Phase 58 — Connection Rejection Diagnosis

**Date:** 2026-10-28

## Verified rejection condition

The live development process reports `resolutionStatus: not-mysql`. The shared
policy produces this status when `new URL(MYSQL_DATABASE_URL)` succeeds but the
parsed protocol is not `mysql:`. The URL validator is enforcing the MySQL
datasource contract required by `prisma/schema.prisma`; evidence does not
indicate a validator defect.

## Sanitized evidence

The live application startup logged:

```json
{
  "source": "MYSQL_DATABASE_URL",
  "present": true,
  "empty": false,
  "urlParses": true,
  "scheme": "other",
  "developmentDatabaseNameSafe": false,
  "productionLikeHost": false,
  "resolutionStatus": "not-mysql"
}
```

`scheme` is a fixed allowlisted category, not the raw protocol. No URL,
username, password, query parameters, hostname, or database name was logged.
The Replit secret listing confirms that the secret exists but does not expose
its value.

The Prisma development runner's `--check-config` mode and the admin bootstrap
script's `--check-config` mode returned the same sanitized fields in the shell.
The application uses Nest `ConfigModule` validation and the workflow starts
`dist/main`; all three supported paths use the same resolver and select
`MYSQL_DATABASE_URL` in development. The shell runner/bootstrap do not show a
stale or different configuration source.

## Files changed

- `src/config/database-url-policy.ts` — added a safe, allowlisted diagnostic
  and retained fail-closed URL validation.
- `src/config/config.service.ts` and `src/database/prisma.service.ts` — expose
  the selected source and sanitized rejection diagnostics at startup.
- `scripts/prisma-dev.cjs` and
  `scripts/bootstrap-platform-admin-dev.cjs` — added `--check-config` modes
  that do not connect, migrate, or create an account.
- `test/config-database-url.spec.ts` — tests sanitized diagnostics for
  alternate schemes, whitespace-only, and malformed values.
- `README.md` — documented the no-connection diagnostic command.

## Verification and database access

- Focused configuration/readiness tests: **21 passed**.
- TypeScript check and Nest build: passed.
- Lint: no errors; one unrelated existing warning remains in
  `test/encounter-operation-reconciliation.spec.ts`.
- Bootstrap shell syntax, Node script syntax, and `git diff --check`: passed.
- Application restarted after the diagnostic change.
- `/health`: HTTP 200.
- `/ready`: HTTP 503, `DATABASE_UNAVAILABLE`.
- No real database connection was attempted or established. The application
  rejected the configuration before `$connect`; no migration or account
  operation was run. Administrator authentication was not tested.

## Remaining action

Update the Replit development secret `MYSQL_DATABASE_URL` to a MySQL/MariaDB
connection URL whose scheme is exactly `mysql://` and whose database name
clearly identifies a development/test target (`dev`, `development`, `test`,
`sandbox`, or `local`). Keep it in the Replit Secrets interface; do not paste
the URL into chat. Once corrected, use the app and runner diagnostics to verify
the selection before attempting a harmless connection check.
