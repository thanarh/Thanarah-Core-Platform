# Thanarah — Historical Central Platform Mongoose → Prisma Migration Impact Report

**Prepared:** August 2026  
**Scope:** Central Platform persistence layer only (`thanarah_platform` database)  
**Document status:** Historical planning report; not a current implementation-status document
**Target ORM:** Prisma 6
**Target DB:** MySQL 8 / MariaDB 10.6+ on cPanel  
**Status at time of report:** The repository was still a Mongoose-oriented scaffold. Historical statements below describe that snapshot, not the current repository.

> **Current architecture:** The central platform migration described here has
> been completed. Prisma 6 with MySQL/MariaDB now owns central platform
> persistence, including the implemented user authentication, sessions, roles,
> permissions, and authorization foundation. Versioned migrations contain the
> schema and required authorization baseline data; there is no Prisma seed
> command.
>
> This migration did **not** eliminate MongoDB from Thanarah. Isolated MongoDB
> database(s) per tenant remain the permanent future architecture for tenant
> healthcare and operational data, potentially with multiple physical
> databases for one tenant. That tenant layer is not yet implemented and must
> be resolved server-side from trusted tenant context, never client input.

---

## 1. Files That Depended on Mongoose or MongoDB at the Time

| File | Dependency | Nature of dependency |
|------|-----------|----------------------|
| `package.json` | `mongoose ^8.15.0`, `@nestjs/mongoose ^11.0.3` | Runtime + dev package declarations |
| `src/database/database.module.ts` | `MongooseModule` from `@nestjs/mongoose` | Registers the Mongoose connection via `forRootAsync` |
| `src/database/database.service.ts` | `InjectConnection`, `Connection`, `ConnectionStates` from `mongoose` / `@nestjs/mongoose` | Injects the live Mongoose `Connection` object for health checks |
| `src/app.module.ts` | `DatabaseModule` (conditionally imported when `MONGO_URI` is set) | Wires the database module into the root module |
| `src/config/env.schema.ts` | `MONGO_URI` field in the Zod env schema | Declares and validates the MongoDB connection string |
| `src/config/config.service.ts` | `mongoUri` getter reads `MONGO_URI` | Typed accessor used by `DatabaseModule` |
| `README.md` | Mentions MongoDB + Mongoose in tech stack and roadmap | Documentation only — no runtime impact |

**Historical total source files with runtime Mongoose dependency: 5**
(database.module.ts, database.service.ts, app.module.ts, env.schema.ts, config.service.ts)

Current source has no Mongoose runtime dependency and uses `DATABASE_URL` for
central Prisma/MySQL/MariaDB persistence.

---

## 2. Schemas and Repositories Identified for Migration

### Committed at the time

No Mongoose `@Schema()` decorated classes or `Model<T>` repositories exist in the repository at this time. The database layer is connection management only.

### Planned at the time

| Planned module | Mongoose artefacts that would have been created | Migration requirement |
|---|---|---|
| Platform User | `User` schema, `UserRepository` | Design as Prisma model `User` in `schema.prisma` instead |
| Platform Roles | `Role` schema, `RoleRepository` | Design as Prisma model `Role` |
| Platform Permissions | `Permission` schema, `PermissionRepository` | Design as Prisma model `Permission` |
| Access baseline | Seeder service reading `Role`/`Permission` models | Ultimately implemented through versioned migrations, not a seed script |

**Because no Mongoose schemas have been written yet, there is no data-at-rest to migrate and no schema transformation cost. This is the ideal moment to switch.**

---

## 3. Current Indexes and Their SQL Equivalents

No Mongoose schemas with index decorators exist in the repository. The table below documents the indexes that **should** be created when the planned models are built with Prisma.

| Entity | Field | Mongoose equivalent | SQL equivalent |
|--------|-------|---------------------|----------------|
| User | `email` | `@index({ unique: true })` | `UNIQUE INDEX idx_users_email (email)` |
| User | `username` (if added) | `@index({ unique: true })` | `UNIQUE INDEX idx_users_username (username)` |
| User | `roleId` (FK) | none (embedded ref) | `INDEX idx_users_role_id (role_id)` |
| Role | `name` | `@index({ unique: true })` | `UNIQUE INDEX idx_roles_name (name)` |
| Role | `isProtected` | none | `INDEX idx_roles_is_protected (is_protected)` |
| Permission | `action` + `resource` | compound `@index` | `UNIQUE INDEX idx_permissions_action_resource (action, resource)` |
| RolePermission | `(roleId, permissionId)` | none (embedded array) | `UNIQUE INDEX idx_role_permissions_composite (role_id, permission_id)` — also the PK of the join table |

---

## 4. Current Platform User Relationships

No `PlatformUser` schema exists in code. Based on the intended design (RBAC system described in the README), the relationships are:

```
PlatformUser  ──────── many-to-one ────────►  Role
Role          ──────── many-to-many ──────────►  Permission   (via RolePermission join table)
```

With Mongoose these would typically be expressed as:
- `User.roleId: ObjectId` (ref to Role collection)
- `Role.permissionIds: ObjectId[]` (array of Permission refs)

In SQL (Prisma) these become normalised foreign keys and a join table — see Section 6.

---

## 5. Current Role and Permission Relationships

No Mongoose schema exists yet. Intended design:

- A **Role** has a name, an optional description, and an `isProtected` flag (for built-in system roles that cannot be deleted).
- A **Permission** represents a single capability: `action` (e.g. `create`, `read`, `update`, `delete`) on a `resource` (e.g. `users`, `reports`). The `(action, resource)` pair is unique.
- A **Role** holds zero or more **Permissions** — a many-to-many relationship.
- A **PlatformUser** is assigned exactly one **Role** at a time (many-to-one).

With Mongoose, permissions would typically be embedded as `ObjectId[]` inside the Role document. In MySQL/MariaDB they must be a join table.

---

## 6. Recommended Normalized SQL Tables

```sql
-- Database
CREATE DATABASE IF NOT EXISTS thanarah_platform
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE thanarah_platform;

-- Permissions
CREATE TABLE permissions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action     VARCHAR(64)  NOT NULL,
  resource   VARCHAR(64)  NOT NULL,
  label      VARCHAR(128) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX idx_permissions_action_resource (action, resource)
);

-- Roles
CREATE TABLE roles (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(64)  NOT NULL,
  description  VARCHAR(255) NULL,
  is_protected TINYINT(1)   NOT NULL DEFAULT 0,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX idx_roles_name (name),
  INDEX idx_roles_is_protected (is_protected)
);

-- Role ↔ Permission (join table)
CREATE TABLE role_permissions (
  role_id       INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role       FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- Platform Users
CREATE TABLE users (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email          VARCHAR(254)  NOT NULL,
  username       VARCHAR(64)   NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,
  role_id        INT UNSIGNED  NOT NULL,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX idx_users_email    (email),
  UNIQUE INDEX idx_users_username (username),
  INDEX         idx_users_role_id (role_id),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
);
```

> **Note on `ON DELETE RESTRICT` for users→roles:** A role should not be deletable while users are assigned to it. The application layer should first reassign users before deleting a role.

---

## 7. Required Foreign Keys

| Constraint name | Child table | Child column | Parent table | Parent column | On delete |
|---|---|---|---|---|---|
| `fk_users_role` | `users` | `role_id` | `roles` | `id` | `RESTRICT` |
| `fk_rp_role` | `role_permissions` | `role_id` | `roles` | `id` | `CASCADE` |
| `fk_rp_permission` | `role_permissions` | `permission_id` | `permissions` | `id` | `CASCADE` |

---

## 8. Required Unique Constraints

| Table | Columns | Purpose |
|---|---|---|
| `users` | `email` | Prevent duplicate accounts |
| `users` | `username` | Prevent duplicate display names |
| `roles` | `name` | Role names must be system-unique |
| `permissions` | `(action, resource)` | Prevents duplicate capability entries |
| `role_permissions` | `(role_id, permission_id)` | Composite PK — prevents duplicate grants |

---

## 9. Required Indexes

| Table | Index | Type | Reason |
|---|---|---|---|
| `users` | `email` | UNIQUE | Login lookup |
| `users` | `username` | UNIQUE | Username lookup |
| `users` | `role_id` | INDEX | FK join + role-membership queries |
| `users` | `is_active` | INDEX (optional) | Filter active users efficiently |
| `roles` | `name` | UNIQUE | Role lookup by name |
| `roles` | `is_protected` | INDEX | Query system roles |
| `permissions` | `(action, resource)` | UNIQUE | Idempotent seed lookup |
| `role_permissions` | `(role_id, permission_id)` | PRIMARY KEY | Join efficiency |

---

## 10. How Protected Roles and Permissions Should Be Represented

### Protected roles

Add an `is_protected TINYINT(1) NOT NULL DEFAULT 0` column on the `roles` table (mapped to `isProtected: Boolean` in Prisma).

Application-layer guard — in the Role service, before any `update` or `delete` operation:

```typescript
// role.service.ts
async deleteRole(id: number): Promise<void> {
  const role = await this.prisma.role.findUniqueOrThrow({ where: { id } });
  if (role.isProtected) {
    throw new ForbiddenException('System roles cannot be deleted.');
  }
  await this.prisma.role.delete({ where: { id } });
}
```

Protected platform roles are created by versioned authorization migrations and
enforced through the current owner/role policy. The historical names and model
below are illustrative and are not current operator instructions.

### Protected permissions

Permissions do not need an `isProtected` flag individually — they are atomic capabilities. Access control is managed at the Role level. If a permission is referenced by a protected role, the `ON DELETE RESTRICT` on the join table (via `fk_rp_permission`) prevents accidental deletion.

---

## 11. Current Authorization Baseline Strategy

The seed-script proposal in the original report was not adopted. The current
repository has no Prisma seed command or `prisma/seed.ts`. Platform role,
permission, role-permission, and owner-policy baseline data is embedded in
versioned migrations so schema and required authorization data advance
together. Operators should use the approved migration workflow rather than
attempting to run a seed command.

---

## 12. Historical Test Impact

At the time, the only test was `test/health.spec.ts`, which was unaffected by
the central persistence migration. The current repository has authentication,
session, authorization, repository, throttling, and HTTP contract tests in
addition to health coverage.

Current service and repository tests use focused manual mocks of
`PrismaService` and its transaction clients. Those tests are the source of
truth for the implemented foundation.

---

## 13. Historical Integration-Test Guidance

No integration tests existed when this report was prepared. Current tests
should be treated as the source of truth.

| Test type | Guidance |
|---|---|
| Database integration tests | Use Prisma's `PrismaClient` pointed at a test database (`DATABASE_URL=mysql://...thanarah_test`). Do NOT use `mongodb-memory-server` or any in-memory MongoDB utility. |
| NestJS e2e tests | Bootstrap the app with a real `PrismaService` backed by a test MySQL database, not a Mongoose connection. |
| Migration baseline tests | Validate versioned migrations and their embedded authorization data against an approved non-production database. |

The `vitest.config.ts` setup is ORM-agnostic and needs no changes.

---

## 14. Whether Prisma Supports the cPanel MySQL or MariaDB Version

| cPanel typically ships | Prisma support |
|---|---|
| MySQL 5.7 | ⚠️ Prisma supports it but it is end-of-life. `DATETIME(3)` precision and `utf8mb4` are available. Some Prisma features (e.g. `@@fulltext` index) require MySQL 8. |
| MySQL 8.0 | ✅ Full Prisma support. Recommended. |
| MariaDB 10.3 – 10.5 | ⚠️ Prisma supports it with the `mysql` provider but has known edge-case gaps (e.g. `RETURNING` clauses, some JSON operators). Basic CRUD and transactions work correctly. |
| MariaDB 10.6+ | ✅ Good Prisma support. Recommended minimum for MariaDB. |

**Recommendation:** Confirm the cPanel host's exact MySQL/MariaDB version before starting. If the host runs MySQL 5.7 or MariaDB < 10.6, request an upgrade or choose a different host tier. Prisma's `datasource` provider for both MySQL and MariaDB is `"mysql"` — no code difference.

---

## 15. Required cPanel Database Information the Owner Must Provide

The following must be obtained from the cPanel account before any Prisma migration can proceed:

| Item | Where to find it | Required for |
|---|---|---|
| MySQL/MariaDB **exact version** | cPanel → MySQL Databases → version string, or `SELECT VERSION()` | Confirming Prisma compatibility |
| **Hostname** of the database server | cPanel → Remote MySQL, or provided by host | `DATABASE_URL` construction |
| **Port** (default 3306, may differ on shared hosting) | Hosting provider docs or cPanel MySQL settings | `DATABASE_URL` |
| **Database name** | To be created: `thanarah_platform` | `CREATE DATABASE` and `DATABASE_URL` |
| **Database username** | Create in cPanel → MySQL Databases → Add User | `DATABASE_URL` |
| **Database password** | Set when creating the user | `DATABASE_URL` (stored as Replit Secret) |
| Whether **remote connections** are permitted | cPanel → Remote MySQL → Add Access Host | Required for Prisma migrations run from Replit/CI |
| Maximum **connection pool size** (shared hosting limits vary) | Ask hosting provider | Prisma `connection_limit` in `DATABASE_URL` |
| **SSL requirement** (some hosts enforce SSL on DB connections) | Hosting provider docs | `sslmode=require` in `DATABASE_URL` |

The resulting `DATABASE_URL` secret will be of the form:
```
mysql://USERNAME:PASSWORD@HOSTNAME:3306/thanarah_platform?connection_limit=5&connect_timeout=10
```

---

## 16. Risks of Migrating Now

| Risk | Severity | Mitigation |
|---|---|---|
| **No domain schemas exist** — the migration is architectural only; nothing has been built on Mongoose yet | Low risk — this is the best possible moment | Start with Prisma from the beginning |
| **cPanel MySQL version unknown** — Prisma may not be fully compatible with older versions | Medium | Obtain the version (Section 15) before writing the schema |
| **cPanel shared hosting connection limits** — shared MySQL databases often limit concurrent connections to 10–25 | Medium | Set `connection_limit=5` in `DATABASE_URL`; test under load |
| **Remote connections may be blocked** — many cPanel hosts default to localhost-only MySQL | Medium | Enable remote access in cPanel → Remote MySQL for the CI/deployment IP |
| **No staging/test database yet** — running migrations directly on production is risky | Medium | Create a separate `thanarah_platform_dev` database in cPanel for development |
| **Prisma migration files must be committed** — `prisma/migrations/` must be in source control for CI apply | Low | Standard practice; no extra tooling needed |
| **cPanel may not allow `ALTER TABLE` with FK constraints on live data** — only relevant once real data exists | Low (no data yet) | Not applicable at this stage |

---

## 17. Risks of Continuing with MongoDB Incorrectly

| Risk | Severity | Notes |
|---|---|---|
| **Architectural mismatch** — central platform data (users, roles, permissions) placed in MongoDB while cPanel only offers MySQL/MariaDB | **Critical** | Every feature built on MongoDB would need to be torn out and rewritten before deployment |
| **cPanel has no MongoDB support** — cPanel's standard MySQL/MariaDB tooling cannot manage MongoDB collections; backup/restore, phpMyAdmin, and cPanel DB wizards do not work with MongoDB | **Critical** | The platform would be undeployable on the intended hosting infrastructure |
| **Accumulated technical debt** — the longer Mongoose schemas are written, the more migration work accumulates | High | Cost compounds with each committed domain module |
| **Customer environment confusion** — MongoDB is intended for customer medical data only; using it for the central platform blurs the architectural boundary defined in the Thanarah design | High | Leads to confusion about which persistence system owns which data |
| **Operational risk** — running a self-hosted MongoDB instance on cPanel alongside MySQL introduces additional infrastructure to maintain, secure, and back up | High | Unnecessary operational burden |
| **Data consistency** — relational RBAC data (users, roles, permissions) is a poor fit for a document database; enforcing referential integrity requires application-level code that SQL enforces natively | Medium | Increases bug surface area |

---

## 18. Exact Staged Migration Plan with the Smallest Safe Steps

Each step is independently deployable and reversible. No step breaks the running application before the next step is ready.

---

### Stage 0 — Information gathering (no code changes)

- [ ] Obtain all cPanel database information listed in Section 15.
- [ ] Confirm MySQL/MariaDB exact version.
- [ ] Confirm remote connections are permitted from the deployment environment.
- [ ] Create two databases in cPanel: `thanarah_platform` (production) and `thanarah_platform_dev` (development).
- [ ] Create a dedicated MySQL user with `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES` on both databases.

---

### Stage 1 — Remove MongoDB wiring, add Prisma infrastructure (historical; completed)

**Files to change:**
1. `package.json` — remove `mongoose`, `@nestjs/mongoose`; add `@prisma/client`, `prisma` (devDep)
2. `src/config/env.schema.ts` — replace `MONGO_URI` with `DATABASE_URL`
3. `src/config/config.service.ts` — replace `mongoUri` with `databaseUrl`
4. `src/database/database.module.ts` — replace `MongooseModule` with `PrismaModule`
5. `src/database/database.service.ts` — replace `InjectConnection` with Prisma `PrismaClient` health check
6. `src/app.module.ts` — remove conditional MongoDB import; always import `DatabaseModule`
7. Add `prisma/schema.prisma` with datasource + generator blocks only (no models yet)
8. Historical proposal: add `prisma/seed.ts` stub (not adopted; baseline data is migration-owned)
9. Run `npx prisma generate` to emit the client
10. Update `.env.example` — replace `MONGO_URI` with `DATABASE_URL`

**Verification:** `npx nest build` succeeds. Health endpoint returns `{ status: "ok" }`. Existing unit test passes.

---

### Stage 2 — Define Prisma schema for permissions and roles (historical; completed)

**Files to change/add:**
1. `prisma/schema.prisma` — add `Permission`, `Role`, `RolePermission` models
2. Run `npx prisma migrate dev --name init-roles-permissions` against `thanarah_platform_dev`
3. Historical seed proposal (superseded by migration-owned baseline data)

**Verification:** Prisma Studio (`npx prisma studio`) shows correct rows. No application code changed yet.

---

### Stage 3 — Implement the Role and Permission NestJS modules (historical; completed)

**Files to add:**
- `src/roles/` — `role.module.ts`, `role.service.ts`, `role.repository.ts`
- `src/permissions/` — `permission.module.ts`, `permission.service.ts`
- Unit tests for each service using a mocked `PrismaService`

**Verification:** Unit tests pass. `npx nest build` succeeds.

---

### Stage 4 — Define Prisma schema for users, implement Platform User module (historical; completed)

**Files to change/add:**
1. `prisma/schema.prisma` — add `User` model
2. Run `npx prisma migrate dev --name add-users`
3. `src/users/` — `user.module.ts`, `user.service.ts`, `user.repository.ts`
4. Historical initial-user proposal; not a current seed workflow
5. Unit tests

**Historical verification target:** unit tests pass and the user table exists with the required schema.

---

### Stage 5 — Apply migrations to production database

1. Run `npx prisma migrate deploy` against `thanarah_platform` (production) — applies all pending migration files from `prisma/migrations/`
2. Verify migration-owned authorization baseline data through an approved production process

**Verification:** Production database matches dev schema. Application starts against production `DATABASE_URL`.

---

### Future — Customer MongoDB environments (separate concern)

When tenant persistence is implemented, each tenant will use isolated MongoDB
database(s), potentially multiple physical databases per tenant. A trusted
tenant context, central database registry, and server-side storage resolver
will map the logical tenant data space to physical storage. Clients must never
choose a database or submit a connection string. Concrete module names,
drivers, and providers have not yet been approved.

| Module | ORM | Database | Scope |
|---|---|---|---|
| `PrismaModule` | Prisma | `thanarah_platform` (MySQL/MariaDB on cPanel) | Central platform |
| Future tenant storage layer | Not selected yet | Isolated tenant MongoDB database(s) | Tenant healthcare and operational data |

They must never share a connection or cross-import each other's models.

---

## Summary

| Point | Finding |
|---|---|
| Historical Mongoose files | 5 source files at the time of the report |
| Current central platform | Prisma 6 schema and migrations with authentication, sessions, roles, and permissions |
| Future tenant persistence | Isolated MongoDB database(s) per tenant; not yet implemented |
| Prisma cPanel compatibility | Confirmed for MySQL 8 / MariaDB 10.6+; version must be verified |
| Production target | cPanel; production database configuration remains in that environment |
