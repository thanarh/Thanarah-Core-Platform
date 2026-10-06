-- AlterTable
ALTER TABLE `PlatformAuditLog` MODIFY `eventType` ENUM('AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT', 'AUTH_LOGOUT_ALL', 'TENANT_CREATED', 'TENANT_STATUS_CHANGED', 'TENANT_DEACTIVATED', 'TENANT_MEMBERSHIP_INVITED', 'TENANT_MEMBERSHIP_ACTIVATED', 'TENANT_MEMBERSHIP_SUSPENDED', 'TENANT_MEMBERSHIP_REMOVED', 'TENANT_ROLE_CREATED', 'TENANT_ROLE_UPDATED', 'TENANT_ROLE_PERMISSIONS_UPDATED', 'TENANT_MEMBERSHIP_ROLE_ASSIGNED', 'TENANT_MEMBERSHIP_ROLE_REMOVED', 'TENANT_OWNER_ASSIGNED', 'TENANT_AUTHORIZATION_DENIED', 'FACILITY_CREATED', 'FACILITY_UPDATED', 'FACILITY_SUSPENDED', 'FACILITY_ACTIVATED', 'FACILITY_DEACTIVATED', 'BRANCH_CREATED', 'BRANCH_UPDATED', 'BRANCH_SUSPENDED', 'BRANCH_ACTIVATED', 'BRANCH_DEACTIVATED', 'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_ACTIVATED', 'PLAN_DEACTIVATED', 'PLAN_ARCHIVED', 'FEATURE_CREATED', 'FEATURE_UPDATED', 'FEATURE_ACTIVATED', 'FEATURE_DEACTIVATED', 'PLAN_FEATURE_ATTACHED', 'PLAN_FEATURE_UPDATED', 'PLAN_FEATURE_DETACHED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_SUSPENDED', 'SUBSCRIPTION_CANCELLED', 'SUBSCRIPTION_EXPIRED') NOT NULL;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `planId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Subscription_tenantId_status_startsAt_endsAt_idx`(`tenantId`, `status`, `startsAt`, `endsAt`),
    INDEX `Subscription_planId_createdAt_idx`(`planId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `PlatformPermission` (`id`, `code`, `updatedAt`) VALUES
  ('7d143d0c-0141-4ac3-bfe9-000000000006', 'subscriptions.read', CURRENT_TIMESTAMP(3)),
  ('7d143d0c-0141-4ac3-bfe9-000000000007', 'subscriptions.manage', CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
CROSS JOIN `PlatformPermission` AS `permission`
WHERE `role`.`code` IN ('OWNER', 'SUPER_ADMIN')
  AND `permission`.`code` IN ('subscriptions.read', 'subscriptions.manage');

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
JOIN `PlatformPermission` AS `permission` ON `permission`.`code` IN (
  'subscriptions.read',
  'subscriptions.manage'
)
WHERE `role`.`code` = 'PLATFORM_ADMIN';
