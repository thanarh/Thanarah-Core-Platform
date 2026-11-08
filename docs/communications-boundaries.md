# Tenant Communications and Automation Boundaries

## Current scope

The communications workspace at `/communications/` provides a tenant-scoped
foundation for WhatsApp and voice consent, retention configuration, synthetic
simulation, and redacted event history. It does not connect to a provider.

- Tenant APIs use the existing authenticated membership and authorization guards.
  MongoDB records are resolved through the active primary placement and every
  query includes the trusted tenant ID.
- Separate tenant permissions cover reading, policy management, consent
  management, and synthetic simulation. Default access is limited to owner and
  admin roles.
- Consent is stored per subject and channel. Opt-in records require a
  non-personal evidence reference; opt-out clears that reference. Inbound
  provider opt-outs are applied only after the adapter authenticates and maps
  the event to trusted tenant scope. Older consent events cannot overwrite a
  newer consent state.
- Retention is unset by default. Provider events are rejected and simulations
  are not logged until the tenant configures a retention period. The configured
  retry-attempt value is policy metadata only; no retry worker is implemented.
- Event expiry is measured from server-side `recordedAt` and stored as a BSON
  date for Mongo TTL cleanup; API reads also filter expired records, because TTL
  cleanup is asynchronous.
- Event records contain only normalized channel, status, template, actor,
  attempt count, timestamps, and internal idempotency/provider references.
  Normalized handoff status events can be correlated internally without exposing
  their correlation reference in the event-read API.
  Public event reads omit provider event IDs and internal idempotency keys.
  Message text, phone numbers, and raw webhook payloads are not accepted or
  persisted by this feature.

## Webhook boundary

Nest captures the exact request bytes for the public webhook routes. Provider
adapters must authenticate signatures against those bytes, resolve the
provider-to-tenant mapping from approved server-side configuration, and return
only normalized status events. A tenant ID in the URL is an untrusted selector,
not evidence of tenant ownership or membership. The controller rejects adapter
results for a different tenant. The adapter contract also includes a provider
subscription-challenge path.

The included HMAC-SHA256 helper verifies the `sha256=<hex>` format over the raw
body with constant-time comparison. It is a building block, not an active
provider integration. The default webhook adapter always fails closed, so no
webhook challenge or event is accepted until a provider adapter and its
server-side secrets are separately approved and configured.

## Explicitly disabled

- No WhatsApp, voice, SMS, or other provider is selected.
- No API accepts arbitrary message text, phone numbers, or caller-selected
  recipients.
- The only executable path is a simulation requiring a `synthetic:` reference,
  per-channel opt-in, and configured retention; it always reports
  `liveSent: false`.
- No real messages, calls, automatic retries, or human-handoff business actions
  are executed. Handoff status can be recorded from normalized provider events,
  but assignment and work execution are not implemented. Future actions must
  call narrowly authorized Thanarah services, not access tenant databases or
  arbitrary external endpoints directly.
- The added permission migration has not been applied to a live database.

Provider selection, secret ownership, approved consent evidence, retention
policy, delivery/retry behavior, and any handoff workflow remain owner decisions
and release gates.
