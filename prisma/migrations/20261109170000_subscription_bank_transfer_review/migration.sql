INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('451807c2-c408-484c-bb00-a840d2891101', 'tenant.finance.payments.read', 'Read tenant bank transfer submissions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('451807c2-c408-484c-bb00-a840d2891102', 'tenant.finance.payments.submit', 'Submit a bank transfer receipt for an issued clinic invoice', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('451807c2-c408-484c-bb00-a840d2891103', 'tenant.finance.payments.review', 'Approve or reject tenant bank transfer receipts with a reason', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('451807c2-c408-484c-bb00-a840d2891104', 'tenant.finance.payments.settings.manage', 'Configure tenant bank transfer instructions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON `permission`.`code` IN (
    'tenant.finance.payments.read',
    'tenant.finance.payments.submit',
    'tenant.finance.payments.review',
    'tenant.finance.payments.settings.manage'
  )
WHERE `role`.`isSystemRole` = true
  AND `role`.`code` IN ('OWNER', 'ADMIN');

ALTER TABLE `Subscription`
  ADD UNIQUE INDEX `Subscription_id_tenantId_key` (`id`, `tenantId`);

CREATE TABLE `SubscriptionPaymentSettings` (
  `id` VARCHAR(16) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `bankName` VARCHAR(100) NULL,
  `accountHolder` VARCHAR(191) NULL,
  `iban` VARCHAR(64) NULL,
  `currencyCode` CHAR(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  `updatedBy` CHAR(36) NULL,
  `history` JSON NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SubscriptionTransfer` (
  `id` CHAR(36) NOT NULL,
  `tenantId` CHAR(36) NOT NULL,
  `subscriptionId` CHAR(36) NOT NULL,
  `status` ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING_REVIEW',
  `amountMinor` BIGINT NULL,
  `currencyCode` CHAR(3) NULL,
  `receiptFileName` VARCHAR(120) NOT NULL,
  `receiptMimeType` VARCHAR(50) NOT NULL,
  `receiptSha256` CHAR(64) NOT NULL,
  `receiptBytes` LONGBLOB NOT NULL,
  `submittedBy` CHAR(36) NOT NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewedBy` CHAR(36) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewReason` VARCHAR(500) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `history` JSON NOT NULL,
  `idempotencyKeyHash` CHAR(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `SubscriptionTransfer_tenant_idempotency_key` (`tenantId`, `idempotencyKeyHash`),
  INDEX `SubscriptionTransfer_tenant_status_submitted_idx` (`tenantId`, `status`, `submittedAt`, `id`),
  INDEX `SubscriptionTransfer_subscription_tenant_status_idx` (`subscriptionId`, `tenantId`, `status`),
  CONSTRAINT `SubscriptionTransfer_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SubscriptionTransfer_subscription_tenant_fkey`
    FOREIGN KEY (`subscriptionId`, `tenantId`) REFERENCES `Subscription` (`id`, `tenantId`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
