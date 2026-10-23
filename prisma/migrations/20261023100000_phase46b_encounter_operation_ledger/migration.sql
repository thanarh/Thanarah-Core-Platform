CREATE TABLE `EncounterOperation` (
  `id` CHAR(36) NOT NULL,
  `tenantId` CHAR(36) NOT NULL,
  `resourceType` VARCHAR(32) NOT NULL,
  `resourceId` CHAR(36) NOT NULL,
  `operationType` VARCHAR(64) NOT NULL,
  `actorUserId` CHAR(36) NULL,
  `historyEventId` CHAR(36) NOT NULL,
  `auditEventType` VARCHAR(64) NOT NULL,
  `auditMetadata` JSON NOT NULL,
  `auditDeliveryStatus` ENUM('PENDING', 'FAILED', 'DELIVERED', 'RECONCILED', 'REVIEW_REQUIRED') NOT NULL DEFAULT 'PENDING',
  `attemptCount` INT NOT NULL DEFAULT 0,
  `lastAttemptAt` DATETIME(3) NULL,
  `lastFailureClassification` VARCHAR(64) NULL,
  `reconciliationOutcome` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `EncounterOperation_historyEventId_key` (`historyEventId`),
  INDEX `EncounterOperation_tenantId_status_createdAt_idx` (`tenantId`, `auditDeliveryStatus`, `createdAt`),
  INDEX `EncounterOperation_status_createdAt_idx` (`auditDeliveryStatus`, `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES ('46b00000-0000-4000-8000-000000000001', 'tenant.encounters.audit.reconcile',
        'Reconcile failed encounter audit delivery within this tenant', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission` ON `permission`.`code` = 'tenant.encounters.audit.reconcile'
WHERE `role`.`isSystemRole` = TRUE AND `role`.`code` = 'OWNER';
