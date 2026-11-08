# Thanarah AI Platform Boundaries

## Decision

The NestJS application remains the authenticated control plane. AI inference runs
in a separately managed Node.js child process connected to Nest through a narrow
request/response interface. The runtime receives no database connection
variables, does not import clinical repositories, and cannot select or execute
arbitrary tools.

This keeps the current single-deployment setup while separating model execution
from clinical business logic. A future deployment may move the runtime behind a
private service transport without changing the model-provider or inference
contracts.

## Tenant data and access

- Nest derives tenant scope from the existing authenticated membership guards.
- Tenant agents, knowledge sources, budgets, and redacted usage records use the
  tenant storage boundary and tenant MongoDB placement. No caller-supplied
  database name or connection string is accepted.
- The runtime receives only the agent configuration, user-provided test text,
  and tenant-scoped knowledge snippets selected by the control plane.
- Medical operations remain unavailable to AI agents until a separately
  authorized Thanarah service is registered as a narrowly scoped tool.
- SQL, MongoDB, arbitrary query, and free-form webhook tools are never exposed.

## Model providers and privacy

- Provider selection is represented by an adapter contract. OpenAI-compatible
  hosted models and a loopback-only Ollama adapter are supported.
- Both adapters are inactive unless their server-side enablement and required
  secret configuration are present. Provider credentials are never stored in
  tenant records, returned by APIs, or written to logs.
- No provider is selected or enabled by this change. No real patient data is
  used. The admin interface and API warn against entering patient information.
- Telemetry records only tenant, agent, provider/model identifiers, token
  estimates, status, and timestamps; prompts, completions, and knowledge text
  are excluded.

## Knowledge retrieval and budgets

- The initial RAG implementation uses tenant-scoped text sources and local
  lexical ranking; it does not require a third-party vector database or
  embedding provider.
- Monthly token budgets and per-request input/output limits must be explicitly
  configured. An unconfigured or exhausted budget rejects inference.
- Provider errors fail closed, release reserved budget, and produce only
  redacted operational telemetry.

## Deferred boundary

Live voice and WhatsApp providers, accepted external webhooks, patient-data
inference, vector embeddings, and hosted-provider activation remain disabled.
The tenant communications foundation supports consent, retention, synthetic
simulation, normalized status storage, and a fail-closed webhook adapter
contract, but it does not send messages, place calls, run retries, or perform
handoff actions. See `docs/communications-boundaries.md` for its release gates.
