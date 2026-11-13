# Internal company operations API

This extends the existing Nest/Fastify app, not a new app. Same-origin vanilla JS at `/company/`, Arabic RTL with optional English. Login uses existing `/api/v1/auth/login` with `{email,password}`, returns `{accessToken}`; refresh POST `/api/v1/auth/refresh` cookies, logout POST `/api/v1/auth/logout` bearer. Tokens only in memory, never localStorage. Bearer required on every `/api/v1/internal` endpoint. Money is integer halalas, SAR only; parse decimal input exactly, display divided by 100. No live bank transfers. ISO date-only and YYYY-MM periods.

## Endpoints
- GET `/api/v1/internal/session`: `{userId,isRoot,permissions:string[],roles:string[],roleCatalog:{id,name,permissions,builtin:true}[], permissionCatalog:string[]}`.
- GET `/api/v1/internal/records/:kind?page=1&limit=100&q=`: `{items:Record[],total,page,limit}`; kinds units, roles, employees, contracts, clients, requests, accounts, policies, journals. Paginated filters; q searches name/title/memo/code. Roles includes built-in role items with id codes; custom records `_id`.
- POST `/api/v1/internal/records/:kind`: `{operationId:crypto.randomUUID(),data:{...}}` returns Record.
- PUT `/api/v1/internal/records/:kind/:id`: `{operationId,data,version}` returns Record. Optimistic concurrency. Only drafts editable for contracts/policies/requests/journals. Financial posted records never editable. Employee role/user change requires access.manage. Delete means archive/inactivate via edit; roles/accounts/units can archive if unreferenced. No destructive delete.
- POST `/api/v1/internal/records/:kind/:id/actions`: `{operationId,version,action,reason,ownerId?}`. actions contract approve/end, policy approve/retire, request submit/approve/reject/escalate, journal post/reverse (reverse creates a draft reversal needing independent posting). Contracts/policies/requests/journals also support cancel when DRAFT, changing status to CANCELLED without deleting history. All approvals/posting reject the record creator, even root. No auto-approved policies.
- POST `/api/v1/internal/accruals`: `{operationId,policyId,employeeId,period:'YYYY-MM',sourceJournalId?,clientId?}` returns DRAFT journal, not payment. Payroll requires approved contract spanning whole month and PAYROLL policy; commission requires WON client and posted journal with recognized positive revenue; profit uses that month's posted revenue less expenses, not user input. Policy rates in basis points, cap in halalas, HALF_UP rounding. Amounts and source/version snapshot generated on server.
- GET `/api/v1/internal/finance?period=YYYY-MM`: trial balance `{period,currency,accounts:[{_id,data:{code,name,type},debitMinor,creditMinor,balanceMinor}],debitMinor,creditMinor,differenceMinor,balanced,revenueMinor,expenseMinor,profitMinor,postedCount}`; whole period, only posted journals, not list slice.
- GET `/api/v1/internal/dashboard/:view` view ceo/cto/director: `{view,counts:{...},requests:{overdue,pending,escalated},finance?:{same finance report}}`; CEO gets financial figures only with finance.read. CTO no salary/finance. No charts necessary; do not invent KPIs/uptime or revenue.
- GET `/api/v1/internal/audit?page=1&limit=50`: `{items:[{_id,actorUserId,action,resource,recordId,at,fromVersion?,toVersion?}],total,page,limit}`; immutable transactional audit, no salary/PII copies.

## Record shape
`{_id,kind,version,createdBy,createdAt,updatedAt,approvedBy?,approvedAt?,data:{...}}`

## Data fields (all required unless ?)
- units: name, unitType COMPANY/DEPARTMENT/SECTION, parentId nullable, status ACTIVE/ARCHIVED.
- roles: name, permissions string[], status ACTIVE/ARCHIVED. Builtins provided in session roleCatalog; noneditable.
- employees: name, userId nullable UUID (link existing platform account, NOT password; `/platform-setup/` manages identities), unitId UUID, jobTitle, roleIds string[], status ACTIVE/INACTIVE.
- contracts: employeeId, title, startDate, endDate nullable, monthlyMinor positive integer, currency SAR, status DRAFT (server transitions APPROVED/ENDED).
- clients: name, contact string (can empty), ownerId employee UUID, stage LEAD/QUALIFIED/PROPOSAL/WON/LOST.
- requests: title, description string, category HR/SALES/FINANCE/TECHNICAL/OPERATIONS, ownerId employee UUID, dueDate YYYY-MM-DD, status DRAFT (server transitions).
- accounts: code alphanum_- max20, name, type ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, currency SAR, status ACTIVE/ARCHIVED.
- policies: name, type PAYROLL/COMMISSION/PROFIT, currency SAR, rateBps integer 0..10000 (PAYROLL must 10000, no partial-month proration), maxAmountMinor positive, debitAccountId, creditAccountId, effectiveFrom, effectiveTo nullable, rounding HALF_UP, status DRAFT. Approved immutable, retire then create revision. Policy debit must EXPENSE for payroll/commission and EQUITY for profit; credit LIABILITY. These represent accruals, not paid status.
- journals manual: memo, kind GENERAL/DEPOSIT/WITHDRAWAL, date, currency SAR, lines:[{accountId,debitMinor,creditMinor}], status DRAFT, clientId? optional UUID linking recognized revenue to a CRM client for later commission. One side positive per line, total debit=credit positive. Deposits/withdrawals require two ASSET accounts. Generated read-only optional fields sourceKey, reversalOf, calculation {policyId,policyVersion,employeeId,period,basisMinor,amountMinor,rateBps,contractId?,contractVersion?,sourceJournalId?,clientId?}. No edit generated journals. Cancelled accrual drafts release uniqueness for a corrected re-calculation; posted originals stay immutable.

## Permissions
organization.read/manage, people.read/manage, access.manage, hr.read/manage/approve, crm.read/manage, requests.read/manage/approve, policies.read/manage/approve, finance.read/manage/post, audit.read, dashboard.ceo/cto/director.
API returns effective permissions; don't show forbidden views or actions. Only root platform OWNER/SUPER_ADMIN can bootstrap all rights without employee mapping; internal staff must be active and linked to active platform account. Role names CEO, CTO, GENERAL_DIRECTOR, HR, ACCOUNTANT, FINANCIAL_CONTROLLER, ACCOUNT_MANAGER, EMPLOYEE; custom roles supported.
Business errors `{error:{code,message}}`, status 400/403/404/409/503. Display safe error and preserve unsaved form and same operationId on uncertain retry. Conflicts require reload. Actions require meaningful reason and separate reviewer; explain this in UI. Search/list empty/error/loading states honest. No sample business data.
