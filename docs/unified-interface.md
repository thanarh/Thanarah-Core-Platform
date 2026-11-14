# Unified responsive interface and in-page authentication

## Scope

The existing Nest-served vanilla-JavaScript application remains in place. The
shared header and footer mount outside route render roots so opening an account
dialog, updating a list, or changing a workspace view does not recreate them.
Role-specific navigation and clinical, administrative and financial actions
remain in their original applications.

The current inventory has **25 HTML entrypoints**, not the 26 reported in the
earlier lightweight-interface write-up. Every current entry loads the shared
shell stylesheet and the authentication and shell scripts once, in that order.

| Area | Covered routes |
| --- | --- |
| Public website | `/`, `/welcome/`, `/site/`, `/about/`, `/services/`, `/packages/`, `/why-thanarah/`, `/contact/` |
| Customer | `/customer/` |
| Team entry and operations | `/platform/`, `/company/`, `/customer-admin/`, `/website-inquiries/` |
| Platform administration | `/platform-setup/`, `/platform-saas/`, `/ai-admin/` |
| Clinic administration | `/clinic-setup/`, `/catalog-setup/`, `/doctor-setup/`, `/team-setup/` |
| Clinical and operational | `/appointments/`, `/patients/`, `/encounters/`, `/finance/`, `/communications/` |

The homepage identity, local fonts, connected Arabic lettering, restrained
palette and absence of decorative motion are preserved. Mobile uses the same
identity and content hierarchy with responsive reflow. Its header actions occupy
their own row rather than overflowing the screen or shrinking into tiny targets.
Complex operational tables keep their existing contained scrolling.

## Supplied images

- Reception: `attached_assets/dummy_1794685154880.png`, served as
  `/assets/thanarah-reception.webp`.
- Laptop and phone: `attached_assets/dummy_1794685157277.png`, served as
  `/assets/thanarah-devices.webp`, with alpha preserved.

The two optimized files total about 224 KiB. The conceptual-image notices remain;
these images are not evidence of an actual office or a released mobile app.
The previously removed facade image is not restored.

## Authentication behavior

- A native modal dialog opens without changing the URL or replacing page content.
  The browser's modal focus containment and background inertness are used;
  Escape closes it and focus returns to the original trigger when still present.
- Login and customer registration use existing API instances and server endpoints.
  Customer registration does not create clinic membership or staff permissions.
  Customer access is checked before announcing successful customer sign-in.
- Existing protected-route login views open the same modal automatically.
  Closing it leaves the shared frame and a button to reopen sign-in. Existing
  applications resume their own permission-checked initialization after login.
- The customer and team audiences remain distinct. Changing identity underneath
  an already-open protected workspace is blocked; its existing sign-out must be
  used first.
- Duplicate submissions are blocked. Registration retains the same operation
  reference and readonly payload following an uncertain server response. Closing
  and reopening the dialog preserves that reference and form within the page.
  Successful registration followed by a login failure retries login, not account
  creation.
- Tokens, passwords and registration payloads are not written to localStorage or
  sessionStorage. Page navigation/reload is not a persistent draft-recovery system.
- Phone entry is explicitly unavailable pending real WhatsApp verification.
  It sends no messages, accepts no test OTP, and creates no phone session.

## Verification

- 124 targeted tests passed across the public renderers, lightweight presentation,
  customer mutation state, shared entrypoint integration, modal submission,
  platform mutation completion and tenant-switching isolation.
- TypeScript passed; changed-test ESLint had no errors. The new isolated test
  harness has return-type warnings under the project's warning-only rule.
- The existing build/start workflow restarted successfully and served on port 5000.
- Desktop (1440 px) and mobile (390 px) homepage screenshots confirmed the new
  images and shared header. A mobile header overflow found during inspection was
  corrected by responsive reflow.
- Operational business rules, database schemas and payment code were not changed.

## Real-browser authentication

One integrated customer journey used a synthetic development account and did not
submit the contact form, create orders, upload files, or change clinical/financial
records.

- Real registration returned 201; login and the permission-checked customer
  profile request returned 200. Registration closed the dialog on `/contact/`
  without changing the URL or losing the unsent contact draft.
- The authenticated workspace link navigated to `/customer/` normally. Logout
  opened the shared modal and re-login returned the portal on the same route.
- The phone mode showed its unavailable notice and made no network request.
  Name and email survived switching between email and phone.
- Escape closed the modal and returned focus. An explicit Tab trap was added
  after the initial pass observed a possible browser-chrome focus stop; its
  targeted check kept all 12 Tab presses within the dialog.
- Restored customer sessions initially showed logged-out header actions.
  Announcing actual protected workspace rendering corrected this, and the
  targeted browser check confirmed the restored portal header.
- Logged-out `/appointments/` and `/encounters/` used the shared staff modal.
  Closing it left the shared frame and a working reopen action. Staff credentials
  were not used; signed-in clinical and staff operations were not browser-tested.
- Desktop home images, header and footer loaded without overflow. The final
  mobile contact and portal checks measured page width equal to viewport width.
- Scroll inspection identified pre-click scrolling of an off-screen header
  trigger. The header now remains available while scrolling and modal code
  restores the opening offset after native focus restoration. The final
  targeted browser check confirmed unchanged background position during open
  and after Escape on mobile (390 px) and desktop (1366 px), with focus returned
  to the header trigger. Mobile coordinate clicks were used after the testing
  tool's locator click reported a node-location error.
- Browser console coverage was incomplete; no claim of an exhaustive console or
  all-role browser audit is made.

No production publishing or WhatsApp provider activation was performed.
