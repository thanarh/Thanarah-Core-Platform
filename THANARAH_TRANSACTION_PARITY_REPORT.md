# Thanarah Transaction-Parity Report

**Updated:** 2026-11-03  
**Status:** No-go. The application transaction workflows remain on Prisma/MySQL.

The source inventory contains 13 transaction-bearing files, plus encounter cross-store coordination. The local replica-set run exercises failed-login updates and a platform-session rotation/reuse candidate, and tests generic snapshot/commit/abort behavior. It does not establish parity for the SQL workflows.

| Workflow | Mongo candidate | Current evidence | Parity status |
|---|---|---|---|
| Platform-user failed-login lockout | `MongoPlatformUserRepository` | Atomic pipeline increment and lockout tested with concurrent synthetic requests | Candidate only; no MySQL differential, restart/ack-loss recovery, or service activation |
| Platform-session rotation and token reuse | `MongoPlatformSessionRepository` candidate | Disposable replica-set tests cover successful rotation, simultaneous same-token rotation/replay, compromise marking, and session lifecycle operations | Candidate only; session-specific stepdown, uncertain commit/recovery, and MySQL differential remain unverified |
| Tenant membership status change | None | No workflow test | Not implemented |
| Tenant role permission replacement/bootstrap | None | No workflow test | Not implemented |
| Tenant membership-role assign/remove | None | No workflow test | Not implemented |
| Tenant staff creation for active membership | None | No workflow test | Not implemented |
| Branch creation under active facility | None | No workflow test | Not implemented |
| Doctor/catalog assignments | None | No workflow test | Not implemented |
| Tenant staff-role assign/remove | None | No workflow test | Not implemented |
| Tenant staff facility/branch scope changes | None | No workflow test | Not implemented |
| Appointment scheduling policy upsert/status and revision | None | No workflow test | Not implemented |
| Subscription creation and lifecycle transition | None | No workflow test | Not implemented |
| Tenant-storage activation and primary switch | None | No workflow test | Not implemented |
| Encounter operation ledger across central SQL and tenant Mongo | None | No cross-store migration protocol test | Not implemented |

The broader source-level requirements and risks are recorded in `PHASE_66_TRANSACTION_COMPATIBILITY_REPORT.md`. Transaction parity is still unverified for every listed workflow, including the two with Mongo candidates. No full transaction callback, session propagation, retry classification, uncertain-ack recovery, or side-effect ordering has been proven for the remaining workflows. The user-approved guard remains: do not register any Mongo adapter until its own behavior and dependent transaction parity are proven.
