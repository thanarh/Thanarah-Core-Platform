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

CREATE TABLE `Staff` (
  `id` CHAR(36) NOT NULL,
  `tenantId` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `membershipId` CHAR(36) NOT NULL,
  `displayName` VARCHAR(191) NOT NULL,
  `jobTitle` VARCHAR(191) NULL,
  `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
  `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `suspendedAt` DATETIME(3) NULL,
  `deactivatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Staff_tenantId_status_createdAt_idx` (`tenantId`, `status`, `createdAt`),
  INDEX `Staff_userId_status_idx` (`userId`, `status`),
  UNIQUE INDEX `Staff_tenantId_userId_key` (`tenantId`, `userId`),
  UNIQUE INDEX `Staff_membershipId_tenantId_userId_key` (`membershipId`, `tenantId`, `userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `TenantMembership_id_tenantId_platformUserId_key`
  ON `TenantMembership` (`id`, `tenantId`, `platformUserId`);

ALTER TABLE `Staff`
  ADD CONSTRAINT `Staff_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Staff`
  ADD CONSTRAINT `Staff_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Staff`
  ADD CONSTRAINT `Staff_membershipId_tenantId_userId_fkey`
  FOREIGN KEY (`membershipId`, `tenantId`, `userId`)
  REFERENCES `TenantMembership` (`id`, `tenantId`, `platformUserId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-000000000018', 'tenant.staff.read', 'View tenant staff profiles', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000019', 'tenant.staff.manage', 'Create, update, suspend, activate, and deactivate tenant staff profiles', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON (
    (`permission`.`code` = 'tenant.staff.read' AND `role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER'))
    OR (`permission`.`code` = 'tenant.staff.manage' AND `role`.`code` IN ('OWNER', 'ADMIN'))
  )
WHERE `role`.`isSystemRole` = TRUE;
