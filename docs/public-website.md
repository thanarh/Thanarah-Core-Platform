# Thanarah public website

The public marketing website is served by the existing Fastify static plugin,
not a second application or authentication system. Routes: `/`, `/about/`,
`/packages/`, `/services/`, `/why-thanarah/`, `/contact/`. `/welcome/` remains
an alias; published service links using `?service=key` remain supported.
The former root workspace launcher is preserved at `/platform/`.
Authenticated application routes and their authentication remain unchanged.

Arabic/RTL is the default; English/LTR is a browser preference. The published
customer catalog is authoritative for package descriptions and features.
The catalog currently has no currency field, so a minor-unit number alone
is not rendered as a monetary offer. Lite, Pro and Customize remain quote-based.
Unpublished details are never presented as confirmed. Live WhatsApp, voice,
external AI, automatic GitHub delivery and the clinic website builder are
not advertised as available integrations.

## Inquiry contract

`POST /api/v1/customer-public/inquiries` validates a strict business-only
payload, required consent, UUID operation reference, email, lengths, optional
E.164 phone, topic, language and optional package code. A honeypot and the
existing IP throttler (five submissions per minute) provide basic spam
deterrence; this is not a CAPTCHA or a guarantee against automated abuse.

The service writes `customer_inquiries` in the existing platform MongoDB
using a majority-acknowledged atomic upsert and MongoDB's unique `_id`.
There is no new database, migration, startup provisioning, payment,
notification or external provider side effect. A receipt is returned only
after persistence is confirmed. Same-reference retries return the original
receipt; changed payloads under that reference return 409. Storage errors
are sanitized 503s. The frontend retains the draft and operation reference
in memory on uncertain errors rather than creating duplicate inquiries.
It never persists inquiry PII in localStorage.

`GET /api/v1/customer-admin/inquiries` requires existing platform
authentication and the existing company-wide `customers.manage_all`
permission. The read-only inbox `/website-inquiries/` reuses the current
CompanyApi session and login. It shows the latest 50 records, explicitly
not a total count, and never grants tenant members access to company leads.
The inbox is linked from the internal launcher, not public navigation.
No email-delivery or response-time promise is made by saving an inquiry.

## Focused checks

- `npx vitest run test/public-inquiries.spec.ts test/public-website.spec.ts`
- `PUBLIC_INQUIRY_TEST_MONGO_URI='mongodb://127.0.0.1:45279/?directConnection=true' npx vitest run test/public-inquiries.integration.spec.ts`

The integration suite accepts only the exact credential-free loopback URI
above, generates a unique `thanarah_public_inquiry_test_…` database and
drops only that database afterward. Start an isolated standalone MongoDB
on that loopback port before running it. It is skipped in normal test runs
and never points at development or production records.

## Verification — 2026-11-14

| Check | Observed result |
| --- | --- |
| Full `npm test` after the navigation fix | 1,088 passed; 125 skipped; 124 files passed, 10 skipped |
| Focused website + inquiry HTTP/unit suites | 33 passed |
| Disposable MongoDB persistence suite | 4 passed: normalized BSON record, fresh-instance retry, concurrent retries, reference conflict |
| Main and tenant-contract TypeScript checks | Both passed |
| Production build (`npm run build`) | Passed |
| ESLint on new/changed TypeScript files | 0 errors, 0 warnings |
| Repository ESLint | Failed: 193 errors, 265 warnings; same pre-existing totals recorded before this work |
| Browser visitor journey | Six routes, Arabic/English, Pro inquiry selection, preserved draft on language change, required consent, one HTTP 201 and retained receipt after language change |
| Responsive browser sweep | All six pages at 768px, 390px and 320px: 18 checks without horizontal overflow; desktop journey at 1440px |
| Existing public entry regression | `/platform/` launcher and existing appointments/customer/customer-admin sign-in screens loaded |
| Inquiry access boundary | Unauthenticated admin endpoint returned 401 without lead data |

The successful browser inquiry was read back through the existing development
Mongo manager with its exact synthetic identifier: persisted consent, BSON
creation date, `NEW` status and Pro selection were confirmed. Only that exact
synthetic record was then removed; no customer records were changed. The
disposable integration database and container were also removed.

Limits: the signed-in staff inbox, broad device/browser and screen-reader
coverage were not verified in a real browser. Browser network-error recovery
was not exercised; backend validation, throttling, storage failure, conflicting
references and uncertain-write retry have focused tests. Default skipped tests
are not presented as passes. There was no production deployment, architecture
change, payment, WhatsApp, voice or external AI activation. This website
delivery does not certify the rest of the platform for production.
