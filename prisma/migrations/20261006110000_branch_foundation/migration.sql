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
    'BRANCH_DEACTIVATED'
  ) NOT NULL;

CREATE TABLE `Branch` (
  `id` CHAR(36) NOT NULL,
  `facilityId` CHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
  `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `suspendedAt` DATETIME(3) NULL,
  `deactivatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Branch_facilityId_status_createdAt_idx` (`facilityId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Branch`
  ADD CONSTRAINT `Branch_facilityId_fkey`
  FOREIGN KEY (`facilityId`) REFERENCES `Facility` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-000000000012', 'tenant.branches.read', 'View branches belonging to tenant facilities', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000013', 'tenant.branches.create', 'Create branches within tenant facilities', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000014', 'tenant.branches.update', 'Update branch details', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000015', 'tenant.branches.suspend', 'Suspend an active branch', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000016', 'tenant.branches.activate', 'Activate a suspended branch', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000017', 'tenant.branches.deactivate', 'Permanently deactivate a branch', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON (
    (`permission`.`code` = 'tenant.branches.read' AND `role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER'))
    OR (`permission`.`code` IN (
      'tenant.branches.create',
      'tenant.branches.update',
      'tenant.branches.suspend',
      'tenant.branches.activate'
    ) AND `role`.`code` IN ('OWNER', 'ADMIN'))
    OR (`permission`.`code` = 'tenant.branches.deactivate' AND `role`.`code` = 'OWNER')
  )
WHERE `role`.`isSystemRole` = TRUE;
