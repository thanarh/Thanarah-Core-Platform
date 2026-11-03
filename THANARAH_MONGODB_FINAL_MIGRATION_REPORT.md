# Thanarah MySQL-to-MongoDB Migration Report

**Updated:** 2026-11-03  
**Decision:** **NO-GO — migration is incomplete and no adapter may be activated.**

## Current state

- Prisma/MySQL remains the only registered and active application persistence path.
- Six candidate Mongo adapters cover six of 22 central persistence ports: platform authorization, platform user, feature, plan, tenant entitlement, and tenant quota.
- Those candidates passed 15 disposable replica-set integration tests, but there is no MySQL differential evidence and no candidate is registered.
- Sixteen persistence ports do not have a full Mongo port adapter.
- Twelve of the 13 inventoried transaction-bearing workflows remain without a Mongo workflow implementation. The failed-login candidate is only locally tested against Mongo, not proven equivalent to MySQL. Encounter cross-store coordination remains unresolved.
- MySQL development connectivity is blocked: sanitized diagnostics report `MYSQL_DATABASE_URL` parses but uses a non-MySQL scheme.
- MySQL string collation, nullable/JSON semantics, pagination, duplicate behavior, transaction isolation, uncertain acknowledgements, recovery, and service-level error mapping are not fully compared.
- Security scans report 2 critical, 2 high, and 11 moderate dependency findings. The highest findings require major upgrades; no upgrades were applied.

## Safety record

Only synthetic local fixtures and a disposable loopback MongoDB replica set were used. No production database was accessed. No data migration, production configuration change, deployment, adapter activation, commit, or staging occurred. No unrelated processes or containers were stopped.

## Required before reconsidering migration

1. Restore safe development-only MySQL connectivity without exposing or guessing credentials.
2. Complete the 22-port implementation and readiness matrices, including every missing adapter and its contract tests.
3. Run MySQL/Mongo differential tests for collation, null/missing values, unique constraints, pagination, and error behavior.
4. Implement and prove all 13 transaction workflows, including concurrency, failover, retry, and uncertain-ack recovery; design and test encounter cross-store reconciliation.
5. Run the full repository suite, build, integration suite, and security audit; publish exact evidence and unresolved risks.
6. Obtain explicit approval for any future production access, data transfer, activation, deployment, or cutover.
