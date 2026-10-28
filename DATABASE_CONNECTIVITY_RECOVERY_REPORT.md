# Database Connectivity Recovery Report

**Date:** 2026-10-28

## Environment classification

The successful cPanel check only confirms that cPanel completed its own
database check; it does not prove that this application can connect, nor does
it identify the target as development. The project README designates the
central production database configuration as belonging in cPanel and requires
a separate development database for Replit.

No cPanel database was accessed or inspected. Because the checked cPanel target
has not been independently identified as an isolated development database, it
is treated as production and must not be used from Replit.

## Sanitized development configuration check

Ran the existing no-connection check:

```text
source: MYSQL_DATABASE_URL
present: true
empty: false
urlParses: true
scheme: other
developmentDatabaseNameSafe: false
productionLikeHost: false
resolutionStatus: not-mysql
```

The secret value, raw protocol, host, database name, credentials, and query
parameters were not accessed or displayed. This does not establish that a
separate usable development database is available. The current Replit
development configuration fails closed before any connection attempt.

## Application status

- `/health`: HTTP 200.
- `/ready`: HTTP 503, `DATABASE_UNAVAILABLE`.
- Application restart: not performed because configuration is not valid.
- Real development database connectivity: not attempted or verified.
- Migrations, production access, database writes, administrator creation or
  reset, and sign-in: not performed.

## Remaining action

Keep the cPanel production database isolated from Replit. Provision or identify
a separate MySQL/MariaDB development database, then set the Replit development
secret `MYSQL_DATABASE_URL` to its `mysql://` connection URL. The database name
must clearly include a development/test marker accepted by the existing policy
(`dev`, `development`, `test`, `sandbox`, or `local`), and its host must not be
production-like.

After that secret is updated, rerun `node scripts/prisma-dev.cjs --check-config`.
Only if it reports `scheme: mysql`, `developmentDatabaseNameSafe: true`, and
`resolutionStatus: ready` should the app be restarted and a harmless connection
check be attempted. Do not paste the URL into chat.
