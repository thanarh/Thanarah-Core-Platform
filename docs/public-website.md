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

## Public-site redesign — 2026-11-14

The six existing routes were redesigned in place. This is not a new application,
authentication system, data model, integration, or production deployment.

### Direction and real product evidence

- A healthcare-technology identity, with warm off-white, botanical green and
  graphite, Arabic IBM Plex Sans Arabic, Manrope and editorial Newsreader.
- The first view names Smart Clinic and distinguishes its existing clinical
  foundation from planned, inactive Thanarah AI and Thanarah Calling.
- A custom SVG scene explains patient → appointment → encounter relationships.
  Dashed, static future branches are explicitly unavailable. It is a conceptual
  explanation, not live telemetry, a recording of patient work, or an activated
  integration.
- The clinical image is the **actual unchanged patient-registration renderer**,
  rendered offline with blank fields and a neutral preview workspace. No account
  was authenticated, no API or database was accessed to create the image, and no
  patient or employee data was included. It is labelled as an interface preview,
  not proof of a complete clinical journey. `scripts/capture-public-product.cjs`
  reproduces the source capture; generated captures and browser profiles are
  excluded from Git and deployment. The shipped WebP is about 23 KB, with explicit
  dimensions, asynchronous decoding and high priority as the main hero image.
- About retains all three supplied leadership names, roles, portraits and
  anchors. Services separates current and future scope; packages retains the
  published-only catalog and quote-based pricing; rationale and contact have
  their own visual treatments. Original bilingual positioning, clinical limits,
  workflow text, benefits, security copy and FAQs remain.

### Motion and accessibility

IntersectionObserver activates the workflow only in view and reveals content on
scroll. A passive scroll listener schedules a single animation frame for the
hero's bounded ±14px parallax; it does not continuously poll the layout.
Reduced-motion changes, Save-Data and hidden tabs stop motion. A keyboard-usable
control pauses/resumes the repeating diagram. Observers, preference/connection,
visibility and scroll listeners, and pending animation frames are removed before
a language rerender. Content is visible by default; reveal hiding is enabled
only after successful observer setup and is disabled for reduced motion.

The diagram has an accessible title, description and text caption. Its visual
sequence is mirrored for RTL. Navigation, focus styles, mobile Escape behavior,
skip link, field labels, consent and the hidden honeypot remain. Primary text
tokens exceed 4.5:1 against the paper background; this is not a full WCAG audit.

### Verification for this redesign

| Check | Observed result |
| --- | --- |
| Build and workflow startup | Passed: existing `npx nest build && node dist/main`; clean application startup |
| Full `npm test` | 1,096 passed; 125 skipped; 124 files passed, 10 skipped |
| `npm run type-check` | Passed |
| `npm run type-check:tenant-contracts` | Passed |
| JavaScript syntax | Passed for public app, content and offline capture script |
| Changed TypeScript ESLint | Passed for the website regression suite |
| Repository `npm run lint` | **Failed**: 193 errors, 265 warnings, matching the previously recorded baseline |
| Diff whitespace | Passed |
| Final focused website suite after accessibility adjustments | 21 passed |
| Browser navigation | All six routes, correct active links and single H1; all footer destinations returned 200 |
| Browser responsive sweep | 24 route/viewport cases: six pages each at Arabic 320/768/1440 and English 390; no horizontal overflow or broken images |
| Browser inquiry UI | Draft and Pro selection survived both language directions; required fields/consent blocked invalid sends; one intercepted 201 showed and retained a simulated receipt |
| Browser motion | Workflow ran in view, paused/resumed from keyboard, stopped offscreen; scroll reveals worked and parallax stayed within ±14px |
| Browser reduced-motion preference | Initial load and runtime change handler passed using a matchMedia shim; native OS emulation was not available |
| Existing application entry points | `/platform/`, `/appointments/` and `/customer/` responded successfully; no signed-in session was tested |

The five new regression cases cover bilingual future-capability boundaries,
truthful product-image captions/loading and preservation of the original home
content. Skipped integration tests are not described as passes.

The browser form check for this redesign uses an intercepted response rather
than creating an inquiry in the development database. Existing backend inquiry
contracts were not changed; this does not re-prove MongoDB persistence.

The browser interception wrapped fetch/XHR and blocked other mutation requests;
one mocked submission was counted, with no inquiry resource request leaving the
page. This is UI acceptance, not a new persistence test. No runtime errors were
captured after the browser error listener was installed.

Two small accessibility observations from the browser pass were addressed:
the skip link now focuses a programmatically focusable main region, and the
motion toggle keeps a constant name with its paused state exposed through
`aria-pressed` and a visible pressed style. The subsequent JavaScript syntax
check and 21-case website regression suite passed; these two adjustments were
not sent through a second full browser pass.

Remaining verification limits: the 320px hamburger was not manually opened
(the 390px open/Escape/focus flow passed); honeypot tab order was checked through
its attributes rather than sequential tabbing; native OS reduced-motion and
Save-Data emulation, a full desktop-English visual pass, screen-reader testing,
authenticated clinic journeys and the staff inquiry inbox were not tested.
Intermittent stale-reference errors in the browser harness were resolved using
CSS/coordinate clicks and were not application failures. No production publish,
database/schema modification, payment, WhatsApp, calling or external AI
activation was performed.

## Homepage reference recreation — 2026-11-14

The owner's supplied screenshots supersede the previous homepage art direction,
not the other five pages. `/` and `/welcome/` alone load the isolated
`reference-home.js` and `reference-home.css`. The compact dark header,
reception hero, benefit strip, clinic/devices image, four solution cards,
three-package green panel, facade/principles, chair CTA and dark footer
follow the supplied composition. All are real HTML controls and text, not
a flattened screenshot. The reception, clinic scene, facade and chair are
optimized copies/crops of the owner's assets, about 65 KiB combined.

Product navigation points to the real clinic section; customer/sign-in controls
use `/customer/`; inquiry buttons use the existing contact page and package
query parameters. The video-looking explanation action links to the clinic
section, not a nonexistent video. The rationale page remains linked in the footer.
Legacy FAQs, clinical limits, approach and security content remain available
through an expandable footer disclosure without adding large unrelated sections.

Visual scenes are labelled conceptual, not an actual office or live interface.
Future AI, website and communications capabilities remain unavailable; package
content still comes only from published catalog entries, with an explicit
unconfirmed state on missing details. No fabricated popularity, customers,
percentage metrics or external social-account links were introduced.

Verification: 24 website regression cases passed, including the actual new
renderer, both languages, source order/isolation, exactly one package update
target, published-only escaping and preserved disclosures. TypeScript passed.
The existing build-and-start workflow restarted successfully; screenshots
confirmed desktop and mobile layouts, and the homepage, welcome, about, contact,
platform and new assets returned HTTP 200. Changed-test ESLint formatting issues
were corrected. There was no new full browser journey, form submission or
repository-wide test/lint run for this frontend-only follow-up. Backend,
authentication, databases and providers were unchanged; nothing was published.
