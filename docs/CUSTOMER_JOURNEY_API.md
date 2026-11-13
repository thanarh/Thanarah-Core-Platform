# Customer journey UI contract

Arabic RTL Thanarah customer acquisition and delivery, separate from clinical
appointments and internal company operations. This extends the existing Nest
app and platform identities. No new auth provider, payment provider, invented
prices or successful WhatsApp verification.

## Frontend integration

Static pages `/welcome/` (public services and packages), `/customer/` (customer
account and application portal), `/customer-admin/` (authorized employees).
Keep existing `/` and clinical pages intact. Use `/assets/logo-mark.svg`.
Load `/company/api.js` then `/journey/api.js`; main agent supplies the latter.
The global `JourneyApi` below returns JSON objects directly, and throws errors
with `status`, `code`, `message`. Authentication tokens remain memory-only,
refresh uses the existing secure cookie. Never store passwords or tokens.

All mutation inputs include `operationId: crypto.randomUUID()`; keep the SAME
operationId AND submitted input across uncertain network/server errors, show it
to the user, and disable duplicate clicks. Keep forms on errors. Definite
4xx rejection permits a fresh operation. All edits/actions include `version`
(optimistic concurrency).

## JSON shapes

Mongo `_id` strings identify records; timestamps serialize as ISO strings.

`CatalogData`: `{registrationOpen:boolean, termsText:string,
services:[{key,title,description,published:boolean}],
packages:[{code:"Lite"|"Pro"|"Customize",description,features:string[],
planId:uuid|null,priceMinor:decimalIntegerString|null,published:boolean}],
documents:[{key,label,required:boolean}],
seller:{name,address,taxNumber,prefix}|null}`.
Exactly the three package codes, no duplicate service/document keys.
Money is SAR integer halalas, never float arithmetic. An absent price is
"السعر بعد مراجعة الطلب", not zero/free. Empty package features mean not yet
published, not promises of features. No fake testimonials or metrics.

`Catalog`: `{_id:"catalog",version,draft:CatalogData,live:CatalogData|null,
liveVersion:number,updatedBy,updatedAt,publishedBy,publishedAt}`.
Edits do not change published content. Independent publication required.

`PublicCatalog`: `{version,registrationOpen,termsText,services,packages,
documents,whatsapp:{available:false,status:"NOT_CONFIGURED"}}`.
Default packages have just their names, no prices/promises; default registration
allows an account, but submitting an application requires published terms.

`Profile`: `{legalName,displayName,registrationNumber,city,address,
contactName,phoneE164}`. All required, strings, phone e.g. `+966500000001`.
`Account`: `{_id:uuid,userId:uuid,email,fullName,profile:Profile|null,
version,phoneVerification:{status:"UNVERIFIED"|"VERIFIED",
phoneE164:string|null,verifiedAt:ISO|null},createdAt,updatedAt}`.
Profile changes never alter platform roles, and changed phone resets verification.

`Order`: `{_id,customerId,version,purpose:"NEW"|"RENEWAL",packageCode,
packageSnapshot:Package,requirements:[{key,label,required}],
termsVersion,profile:Profile,status,open,managerId:uuid|null,
clientId:uuid|null,tenantId:uuid|null,subscriptionId:uuid|null,
parentOrderId:uuid|null,reason:string|null,createdAt,updatedAt,
approvedBy:uuid|null,activatedBy:uuid|null,deliveredAt:ISO|null}`.
Statuses: DRAFT, SUBMITTED, CHANGES_REQUESTED, REJECTED, APPROVED, ACTIVE,
DELIVERED, CANCELLED. One open order per customer. Assignments link to the
existing internal employees and CRM clients. Customer sees only their records.
Documents upload only in DRAFT or CHANGES_REQUESTED. ACTIVE means staff checked
an existing prepared tenant/subscription/owner; DELIVERED requires the customer
to acknowledge receipt. No password is sent. A renewal is a NEW review cycle,
not an automatic extension of paid dates.

`Document`: `{_id,orderId,key,fileName,mimeType,sha256,size,status:
"PENDING"|"APPROVED"|"REJECTED",reason,version,superseded,uploadedAt,reviewedAt}`.
Download only via protected API, attachment, not public static URLs.
PDF, PNG, JPEG only, 4MiB max/file. Multipart field `receipt` deliberately
reuses the existing validated file parser, extra fields `key`, `version`,
`operationId`. Never embed document bytes in JSON.

`Invoice`: `{_id,orderId,customerId,tenantId,subscriptionId,version,
status:"DRAFT"|"ISSUED"|"PAID"|"VOID",number:string|null,
subtotalMinor,taxMinor,totalMinor,currency:"SAR",description,dueDate,
seller:null|Seller,createdBy,issuedBy,transferId:null|uuid,
issuedAt:null|ISO,createdAt,updatedAt}`.
No inferred tax rate. Drafts explicitly labeled non-issued, non-tax-compliance
claim. Issue requires an independently approved published seller policy,
independent finance reviewer, and an active linked subscription. Payment only
links a real approved matching transfer through existing subscription payment
review; no arbitrary "mark paid" button.

`Event`: `{_id,orderId,action,actorUserId,at,reason,fromVersion,toVersion}`.
`Review`: `{_id,orderId,customerId,rating:1..5,comment,createdAt}` private
feedback, one per delivered order, never published as testimonials automatically.

## Exact available methods

Public/auth:
- `catalog()` -> PublicCatalog.
- `register({operationId,fullName,email,password})` -> `{registered:true}`.
  Creates a platform login identity with NO company/tenant roles, plus customer
  account. It does not auto-login. Then call `login(email,password)`.
- `login(email,password)` -> boolean; `restoreSession()` -> boolean;
  `logout()` -> void.

Customer:
- `me()` -> `{account,orders:Order[],whatsapp:{available:false,status:"NOT_CONFIGURED"}}`.
- `profile({operationId,version,profile})` -> Account.
- `createOrder({operationId,packageCode,parentOrderId?:uuid})` -> Order.
- `order(id)` -> `{order,documents:Document[],events:Event[],invoices:Invoice[],
review:Review|null,delivery:{available:boolean,url:string|null}}`.
- `customerAction(id,{operationId,version,action:"submit"|"cancel"|"acknowledge",
reason?:string,acceptedTermsVersion?:number})` -> Order. Submit requires the
explicitly accepted `order.termsVersion`; display its immutable `order.termsText`.
- `upload(id,formData)` -> Document.
- `downloadDocument(id)` -> authenticated browser download.
- `sendWhatsApp({operationId})` -> always 503 `CUSTOMER_WHATSAPP_UNAVAILABLE`.
- `review(id,{operationId,rating,comment})` -> Review.
- `subscription(id)` -> existing tenant subscription portal JSON (only for
  own ACTIVE/DELIVERED linked order): `{subscription,transfers,paymentInstructions,...}`.
  Treat returned structure defensively and display actual data; do not invent.
- `uploadTransfer(id,formData,operationId)` -> existing transfer submission,
  FormData field `receipt` ONLY; no extra fields. Existing bank instructions
  may be disabled, display that explicitly.

Admin:
- `adminSession()` -> `{userId,isRoot,permissions:string[],employeeId?,
employees:[{_id,data:{name,roleIds,status,...}}],
plans:[{_id,key,name,status}],tenants:[{_id,legalName,displayName,status}],
subscriptions:[{_id,tenantId,planId,status,startsAt,endsAt}]}`.
  Permissions: customers.read (assigned scope), customers.manage,
  customers.manage_all (all accounts/unassigned), customers.review,
  customers.activate, customers.catalog, finance.read/manage/post.
- `adminCatalog()` -> Catalog; `saveCatalog({operationId,version,data:CatalogData})`
  -> Catalog; `publishCatalog({operationId,version,reason})` -> Catalog.
  Independent publisher required, not last editor. Draft configuration must
  have explicit terms before publication; seller may remain null (billing off).
- `adminOrders({page?:number,status?:string})` -> `{items:Order[],total,page,limit:30}`.
- `adminOrder(id)` -> same detail as customer + `account`.
- `adminAction(id,{operationId,version,action:"assign"|"request_changes"|
"reject"|"approve"|"activate",reason,managerId?:uuid,tenantId?:uuid,
subscriptionId?:uuid})` -> Order.
  Activate validates a tenant/subscription PREPARED through existing platform
  setup (links `/platform-setup/`, `/team-setup/`, `/platform-saas/`), exact
  active OWNER membership for this customer, matching package plan, live
  subscription, and active primary storage. No manual verify bypass; without
  WhatsApp provider activation explicitly blocks, never simulates delivery.
- `reviewDocument(id,{operationId,version,decision:"APPROVED"|"REJECTED",reason})`
  -> Document.
- `adminDownloadDocument(id)` -> authenticated browser download.
- `createInvoice(orderId,{operationId,subtotalMinor,taxMinor,description,dueDate})`
  -> Invoice; invoice has one non-void record per order.
- `invoiceAction(id,{operationId,version,action:"issue"|"void"|"link_payment",
reason,transferId?:uuid})` -> Invoice.
- `adminEvents({page?:number})` -> `{items:Event[],total,page,limit:50}`.

## UI requirements

Expose all the above functional surfaces, not JSON-only API placeholders.
Staff catalog editor can use structured forms for services/packages/requirements
and seller; include draft/publication status, no plain JSON editor as main UI.
Customer must accept the displayed published terms explicitly before submit.
State transitions and blocked reasons must be comprehensible in Arabic.
Do not let admin view a customer password or set verification success.
Show purpose/renewal, document rejection reasons, assigned account-manager name
when available, chronological events, and the real receipt acknowledgment.
Return only a generic registration conflict; do not enumerate existing users.
Keep all old app routes and permissions unchanged.
