ALTER TABLE `PlatformAuditLog`
  MODIFY `eventType` ENUM(
    'AUTH_LOGIN_SUCCEEDED',
    'AUTH_LOGOUT',
    'AUTH_LOGOUT_ALL',
    'TENANT_CREATED',
    'TENANT_STATUS_CHANGED',
    'TENANT_DEACTIVATED',
    'TENANT_MEMBERSHIP_INVITED',
    'TENANT_MEMBERSHIP_ACTIVATED',
    'TENANT_MEMBERSHIP_SUSPENDED',
    'TENANT_MEMBERSHIP_REMOVED',
    'TENANT_ROLE_CREATED',
    'TENANT_ROLE_UPDATED',
    'TENANT_ROLE_PERMISSIONS_UPDATED',
    'TENANT_MEMBERSHIP_ROLE_ASSIGNED',
    'TENANT_MEMBERSHIP_ROLE_REMOVED',
    'TENANT_OWNER_ASSIGNED',
    'TENANT_AUTHORIZATION_DENIED',
    'FACILITY_CREATED',
    'FACILITY_UPDATED',
    'FACILITY_SUSPENDED',
    'FACILITY_ACTIVATED',
    'FACILITY_DEACTIVATED',
    'BRANCH_CREATED',
    'BRANCH_UPDATED',
    'BRANCH_SUSPENDED',
    'BRANCH_ACTIVATED',
    'BRANCH_DEACTIVATED',
    'STAFF_CREATED',
    'STAFF_UPDATED',
    'STAFF_SUSPENDED',
    'STAFF_ACTIVATED',
    'STAFF_DEACTIVATED',
    'STAFF_ROLE_ASSIGNED',
    'STAFF_ROLE_REMOVED',
    'STAFF_FACILITY_ASSIGNED',
    'STAFF_FACILITY_UNASSIGNED',
    'STAFF_BRANCH_ASSIGNED',
    'STAFF_BRANCH_UNASSIGNED',
    'DEPARTMENT_CREATED',
    'DEPARTMENT_UPDATED',
    'DEPARTMENT_ACTIVATED',
    'DEPARTMENT_SUSPENDED',
    'DEPARTMENT_DEACTIVATED',
    'SPECIALTY_CREATED',
    'SPECIALTY_UPDATED',
    'SPECIALTY_ACTIVATED',
    'SPECIALTY_SUSPENDED',
    'SPECIALTY_DEACTIVATED',
    'PLAN_CREATED',
    'PLAN_UPDATED',
    'PLAN_ACTIVATED',
    'PLAN_DEACTIVATED',
    'PLAN_ARCHIVED',
    'FEATURE_CREATED',
    'FEATURE_UPDATED',
    'FEATURE_ACTIVATED',
    'FEATURE_DEACTIVATED',
    'PLAN_FEATURE_ATTACHED',
    'PLAN_FEATURE_UPDATED',
    'PLAN_FEATURE_DETACHED',
    'SUBSCRIPTION_CREATED',
    'SUBSCRIPTION_ACTIVATED',
    'SUBSCRIPTION_SUSPENDED',
    'SUBSCRIPTION_CANCELLED',
    'SUBSCRIPTION_EXPIRED'
  ) NOT NULL;

CREATE TABLE `Department` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(512) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `suspendedAt` DATETIME(3) NULL,
    `deactivatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Department_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `Department_id_tenantId_key`(`id`, `tenantId`),
    UNIQUE INDEX `Department_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Specialty` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(512) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `suspendedAt` DATETIME(3) NULL,
    `deactivatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Specialty_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `Specialty_id_tenantId_key`(`id`, `tenantId`),
    UNIQUE INDEX `Specialty_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Department`
  ADD CONSTRAINT `Department_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Specialty`
  ADD CONSTRAINT `Specialty_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-000000000024', 'tenant.departments.read', 'View department definitions in the tenant healthcare catalog', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000025', 'tenant.departments.manage', 'Create, update, and change the lifecycle of tenant department definitions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000026', 'tenant.specialties.read', 'View specialty definitions in the tenant healthcare catalog', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000027', 'tenant.specialties.manage', 'Create, update, and change the lifecycle of tenant specialty definitions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON (
    (`permission`.`code` IN ('tenant.departments.read', 'tenant.specialties.read')
      AND `role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER'))
    OR (`permission`.`code` IN ('tenant.departments.manage', 'tenant.specialties.manage')
      AND `role`.`code` IN ('OWNER', 'ADMIN'))
  )
WHERE `role`.`isSystemRole` = TRUE;
