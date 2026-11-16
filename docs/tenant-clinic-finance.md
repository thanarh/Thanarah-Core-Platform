# Tenant Clinic Finance Foundation

## Scope and storage boundary

Clinic invoices are tenant operational records. Their settings, drafts, reviewed
versions, issued numbers, totals, and invoice-local audit history are stored in
the tenant's MongoDB database through the existing tenant-storage resolver.
Central MySQL/Prisma stores only the finance permission catalog and role grants;
it does not store clinic invoices. Platform SaaS subscriptions remain a separate
central workflow and are not clinic invoices.

The API is under `/api/v1/tenants/:tenantId/finance`. Each request requires
platform authentication, an active tenant membership, trusted tenant context,
and an operation-specific finance permission. Tenant identifiers in request
paths are selectors only; the server resolves the active tenant storage target.
The UI is available at `/finance/`.

## Invoice lifecycle

The supported lifecycle is:

`DRAFT → REVIEWED → ISSUED`

A reviewed invoice may return to draft before issue; the return requires a
reason and is recorded in invoice history. Drafts use optimistic version
checks. Review calculates and freezes totals and snapshots the settings used.
Issuing assigns a configured manual or sequential number and makes financial
details immutable. There is no delete, void, paid, refund, cancellation, or
payment-collection transition in this foundation.

Create requests may include an idempotency key. Only its hash and a request
fingerprint are persisted, and a repeated key with different content is
rejected. Tenant-local uniqueness indexes protect invoice numbers and
idempotency records. Issue operations reserve a sequence in the tenant
settings document before finalizing, so an interrupted request can be
reconciled on retry without assigning the same sequence twice.

## Configurable behavior

- Currency is stored as the configurable ISO code `SAR`; visible amounts use
  the owner-supplied Saudi-riyal symbol. No price is prefilled.
- Tax rules, including an explicit no-tax choice, are tenant settings. No rate
  or tax treatment is enabled by default.
- Line and tax rounding are explicit settings.
- Custom invoice fields are configurable; no legal field set is asserted.
- Numbering can be manual or sequential only after an administrator configures
  it. The sequence counter is preserved across settings changes and numbering
  modes; the configured starting number seeds it only when no counter exists.
  No periodic or legal reset policy is assumed, and duplicate issued numbers
  are rejected within the tenant.
- Amounts are calculated with integer currency-minor units and quantity
  thousandths, using `BigInt` intermediates to avoid floating-point drift.

## Manual bank-transfer receipts

The clinic finance workspace can collect a receipt for an issued invoice only
when transfer instructions are explicitly configured and the invoice currency
matches. A separate payment permission controls receipt submission; a separate
review permission controls approve/reject decisions and requires a reason.
Receipts remain tenant-scoped and are not returned in ordinary invoice
responses. Approving a receipt records a review only: it does not mark an
invoice paid or move money.

The clinic subscription portal uses a separate central subscription workflow
for receipt submission and platform-side review. It does not infer an
subscription amount or extend a subscription when a receipt is accepted.
Card and Apple Pay are visible only as disabled “قريبًا” options in both
payment views.

Settings updates are versioned and recorded in revision history. Invoice audit
events are bounded; reaching the configured limit stops further mutations and
requires operator review rather than deleting audit history.

## Decisions required before legal or payment readiness

The foundation does not claim legal, tax, accounting, or collection readiness.
The product owner and qualified reviewers still need to decide:

1. Which jurisdiction-specific legal fields and invoice wording are required.
2. Which tax treatments, rates, calculation bases, and rounding rules apply.
3. Whether invoice numbering resets by year, facility, or another approved
   scope, and how duplicate or corrected numbers should be handled.
4. Whether invoices should also link to appointments or clinical services.
5. Whether voids, credit notes, refunds, or payment allocation are required.

New invoices may be linked to an active patient record while still a draft.
The patient portal at `/patient-portal/` requires a signed-in Thanarah account,
an explicit consent checkbox, an exact email match to one active patient
record, and a one-time code sent only to that record's stored phone. The
patient sees only issued invoices linked to the verified record. The link is
revoked if the record's email or phone changes. Issued invoices that were not
linked before issuance are not shown in the portal.

OTP delivery fails closed unless the Thanarah WhatsApp API key and OTP HMAC
secret are configured. Saudi local mobile numbers are normalized to `+966`;
other numbers must already be in international format. The portal never
confirms whether an email matched. Codes expire after five minutes and allow
at most five verification attempts. This OTP request is a messaging action
only; it does not initiate a payment.

No payment provider is called by these manual receipt flows. Paymob remains a
separate final roadmap stage after both manual-transfer paths and product
acceptance; this foundation does not authorize sandbox or production charges.
