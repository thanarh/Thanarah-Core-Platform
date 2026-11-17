# Tenant role defaults migration

The built-in tenant role definitions seed new tenants during owner bootstrap. They do not update existing tenant grants automatically at application startup.

The explicit development migration updates the system-role names and permission links for every tenant in the configured development/test MongoDB database. It preserves existing role IDs and assignments, creates the new specialist roles without assigning them to users, and records each change in the platform audit log. A custom role that uses a newly reserved built-in code blocks the migration before any tenant is updated.

The `ADMIN` and `MEMBER` role codes remain stable for existing assignments. Their names and grants change to Clinic Manager and Viewer. Users assigned only those roles lose finance, AI, communications, website, subscription, patient, or appointment permissions that are no longer part of those profiles. Assign specialist roles only after reviewing each person's work.

The script refuses non-development environments and database names that do not look like `dev` or `test`. It is not run automatically. To execute it against the configured development/test database:

```sh
npm run build
NODE_ENV=development node scripts/migrate-tenant-role-defaults-dev.cjs --apply-tenant-role-defaults-v2
```

Do not remove the environment or database-name checks to run this against production. Production migration requires a separate authorization and review.

Finance preparer and approver are separate permission bundles, but users can hold multiple roles. This migration does not enforce mutual exclusion between them.
