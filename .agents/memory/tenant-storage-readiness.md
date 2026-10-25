---
name: Tenant storage readiness
description: The scope and safety expectations for tenant-storage health and recovery checks.
---

Use a provider-neutral health contract for application readiness and probe the shared configured adapter with a bounded service-level check. Do not enumerate and synchronously probe every tenant database on each readiness request. A healthy shared service does not imply every tenant registry entry is active or usable; target resolution must enforce that independently.

Keep liveness independent from dependency readiness and return generic diagnostics that reveal no tenant identifiers, credentials, connection strings, or provider exceptions. Production must fail closed when required persistent storage is missing or cannot establish readiness.

Recovery specifications must distinguish requirements from verified capabilities. Do not claim backups/restores exist or assign RPO/RTO, retention, topology, or consistency guarantees without approved evidence.

**Why:** Global probe cost and exposure should not scale with tenant count, and recovery claims require operational evidence rather than assumptions.

**How to apply:** When adding a storage provider, implement the shared health contract in its adapter and test healthy, unavailable, and recovery behavior without changing tenant-target authorization semantics.
