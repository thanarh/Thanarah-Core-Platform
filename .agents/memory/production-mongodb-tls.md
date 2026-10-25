---
name: Production MongoDB TLS
description: Security policy for tenant MongoDB TLS configuration in production.
---

Production tenant MongoDB configuration must enable TLS and retain certificate-chain and hostname validation. Standard `mongodb` URIs must explicitly set `tls=true` or `ssl=true`; `mongodb+srv` may use the official driver's TLS default. Reject explicit TLS disablement and options that bypass certificate or hostname validation. Development and staging are not subject to this production-only configuration gate.

**Why:** tenant storage can contain clinical data, and production must fail closed when transport validation is disabled without assuming a specific provider or topology.

**How to apply:** preserve the driver’s normal certificate and hostname validation; test URI parsing for supported schemes, aliases, and bypass flags. URI validation is not proof that the configured endpoint completes a valid TLS handshake.
