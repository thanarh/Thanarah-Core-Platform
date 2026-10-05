-- AlterTable
ALTER TABLE `PlatformAuditLog` MODIFY `eventType` ENUM('AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT', 'AUTH_LOGOUT_ALL', 'TENANT_CREATED', 'TENANT_STATUS_CHANGED', 'TENANT_DEACTIVATED', 'TENANT_MEMBERSHIP_INVITED', 'TENANT_MEMBERSHIP_ACTIVATED', 'TENANT_MEMBERSHIP_SUSPENDED', 'TENANT_MEMBERSHIP_REMOVED', 'TENANT_ROLE_CREATED', 'TENANT_ROLE_UPDATED', 'TENANT_ROLE_PERMISSIONS_UPDATED', 'TENANT_MEMBERSHIP_ROLE_ASSIGNED', 'TENANT_MEMBERSHIP_ROLE_REMOVED', 'TENANT_OWNER_ASSIGNED', 'TENANT_AUTHORIZATION_DENIED', 'FACILITY_CREATED', 'FACILITY_UPDATED', 'FACILITY_SUSPENDED', 'FACILITY_ACTIVATED', 'FACILITY_DEACTIVATED', 'BRANCH_CREATED', 'BRANCH_UPDATED', 'BRANCH_SUSPENDED', 'BRANCH_ACTIVATED', 'BRANCH_DEACTIVATED', 'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_ACTIVATED', 'PLAN_DEACTIVATED', 'PLAN_ARCHIVED', 'FEATURE_CREATED', 'FEATURE_UPDATED', 'FEATURE_ACTIVATED', 'FEATURE_DEACTIVATED', 'PLAN_FEATURE_ATTACHED', 'PLAN_FEATURE_UPDATED', 'PLAN_FEATURE_DETACHED') NOT NULL;

-- CreateTable
CREATE TABLE `Plan` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Plan_key_key`(`key`),
    INDEX `Plan_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feature` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Feature_key_key`(`key`),
    INDEX `Feature_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanFeature` (
    `planId` CHAR(36) NOT NULL,
    `featureId` CHAR(36) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlanFeature_featureId_createdAt_idx`(`featureId`, `createdAt`),
    PRIMARY KEY (`planId`, `featureId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlanFeature` ADD CONSTRAINT `PlanFeature_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanFeature` ADD CONSTRAINT `PlanFeature_featureId_fkey` FOREIGN KEY (`featureId`) REFERENCES `Feature`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `PlatformPermission` (`id`, `code`, `updatedAt`) VALUES
  ('7d143d0c-0141-4ac3-bfe9-000000000001', 'plans.read', CURRENT_TIMESTAMP(3)),
  ('7d143d0c-0141-4ac3-bfe9-000000000002', 'plans.manage', CURRENT_TIMESTAMP(3)),
  ('7d143d0c-0141-4ac3-bfe9-000000000003', 'features.read', CURRENT_TIMESTAMP(3)),
  ('7d143d0c-0141-4ac3-bfe9-000000000004', 'features.manage', CURRENT_TIMESTAMP(3)),
  ('7d143d0c-0141-4ac3-bfe9-000000000005', 'plan_features.manage', CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
CROSS JOIN `PlatformPermission` AS `permission`
WHERE `role`.`code` IN ('OWNER', 'SUPER_ADMIN')
  AND `permission`.`code` IN (
    'plans.read',
    'plans.manage',
    'features.read',
    'features.manage',
    'plan_features.manage'
  );

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
JOIN `PlatformPermission` AS `permission` ON `permission`.`code` IN (
  'plans.read',
  'plans.manage',
  'features.read',
  'features.manage',
  'plan_features.manage'
)
WHERE `role`.`code` = 'PLATFORM_ADMIN';
