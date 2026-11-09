import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATFORM_PERMISSION_CODES } from '../src/auth/platform-authorization.constants';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20261006140000_saas_subscription_foundation/migration.sql',
  'utf8',
);
const transferMigration = readFileSync(
  'prisma/migrations/20261109170000_subscription_bank_transfer_review/migration.sql',
  'utf8',
);
const subscriptionModel = schema.match(/model Subscription\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const transferModel = schema.match(/model SubscriptionTransfer\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('SaaS Subscription schema and migration', () => {
  it('stores only the tenant-specific Plan assignment and required period/lifecycle fields', () => {
    expect(schema).toMatch(
      /enum SubscriptionStatus\s*\{\s*ACTIVE\s+SUSPENDED\s+CANCELLED\s+EXPIRED\s*\}/,
    );
    expect(subscriptionModel).toMatch(/\btenantId\s+String\s+@db\.Char\(36\)/);
    expect(subscriptionModel).toMatch(/\bplanId\s+String\s+@db\.Char\(36\)/);
    expect(subscriptionModel).toMatch(/\bstatus\s+SubscriptionStatus/);
    expect(subscriptionModel).toMatch(/\bstartsAt\s+DateTime/);
    expect(subscriptionModel).toMatch(/\bendsAt\s+DateTime\?/);
    expect(subscriptionModel).toMatch(/\bcancelledAt\s+DateTime\?/);
    expect(subscriptionModel).not.toMatch(
      /\b(price|currency|billingInterval|paymentProvider|invoiceId|autoCharge|usage|quota)\b/i,
    );
    expect(subscriptionModel).toMatch(/tenant\s+Tenant\s+@relation/);
    expect(subscriptionModel).toMatch(/plan\s+Plan\s+@relation/);
  });

  it('uses required restrictive foreign keys and indexes for tenant/current/history reads', () => {
    expect(subscriptionModel).toMatch(/@@index\(\[tenantId, status, startsAt, endsAt\]\)/);
    expect(subscriptionModel).toMatch(/@@index\(\[planId, createdAt\]\)/);
    expect(migration).toContain('Subscription_tenantId_fkey');
    expect(migration).toContain('Subscription_planId_fkey');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('Subscription_tenantId_status_startsAt_endsAt_idx');
    expect(migration).toContain('Subscription_planId_createdAt_idx');
    expect(migration).not.toContain('ON DELETE CASCADE');
  });

  it('extends only the existing platform audit event enum with events used by this phase', () => {
    for (const event of [
      'SUBSCRIPTION_CREATED',
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION_SUSPENDED',
      'SUBSCRIPTION_CANCELLED',
      'SUBSCRIPTION_EXPIRED',
    ]) {
      expect(schema).toContain(event);
      expect(migration).toContain(`'${event}'`);
    }
    expect(schema).not.toContain('SUBSCRIPTION_RENEWED');
    expect(migration).not.toContain('TenantEntitlement');
  });

  it('adds only read/manage platform permissions with the established administrator grants', () => {
    for (const permission of ['subscriptions.read', 'subscriptions.manage']) {
      expect(PLATFORM_PERMISSION_CODES).toContain(permission);
      expect(migration).toContain(`'${permission}'`);
    }
    expect(migration).toContain('INSERT IGNORE INTO `PlatformPermission`');
    expect(migration).toContain("`role`.`code` IN ('OWNER', 'SUPER_ADMIN')");
    expect(migration).toContain("`role`.`code` = 'PLATFORM_ADMIN'");
    expect(migration).not.toMatch(/`role`\.`code`.*(SECURITY_ADMIN|SUPPORT_ADMIN)/);
    expect(migration).not.toMatch(/subscriptions\.(?:billing|payment|invoice|usage)/i);
  });

  it('keeps subscription transfer receipts centralized and disabled until configured', () => {
    expect(schema).toMatch(
      /enum SubscriptionTransferStatus\s*\{\s*PENDING_REVIEW\s+APPROVED\s+REJECTED\s*\}/,
    );
    expect(transferModel).toMatch(/\btenantId\s+String/);
    expect(transferModel).toMatch(/\bsubscriptionId\s+String/);
    expect(transferModel).toMatch(/\breceiptBytes\s+Bytes\s+@db\.LongBlob/);
    expect(transferModel).toMatch(/@@index\(\[subscriptionId, tenantId, status\]/);
    expect(transferModel).not.toMatch(/\b(price|tax|dueAt|refund|provider|autoCharge)\b/i);
    expect(transferMigration).toContain('CREATE TABLE `SubscriptionPaymentSettings`');
    expect(transferMigration).toContain('`enabled` BOOLEAN NOT NULL DEFAULT false');
    expect(transferMigration).toContain('CREATE TABLE `SubscriptionTransfer`');
    expect(transferMigration).toContain('ENUM(');
    expect(transferMigration).toContain('`receiptBytes` LONGBLOB NOT NULL');
    expect(transferMigration).toContain('FOREIGN KEY (`subscriptionId`, `tenantId`)');
    expect(transferMigration).not.toContain('CREATE TYPE');
    expect(transferMigration).not.toMatch(
      /UPDATE `Subscription`|ALTER TABLE `Subscription`.*status/u,
    );
    expect(transferMigration).not.toMatch(/subscriptions\.(?:payment|billing|invoice)/i);
  });
});
