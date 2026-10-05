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
    'FACILITY_DEACTIVATED'
  ) NOT NULL;

CREATE TABLE `Facility` (
  `id` CHAR(36) NOT NULL,
  `tenantId` CHAR(36) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
  `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `suspendedAt` DATETIME(3) NULL,
  `deactivatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `Facility_tenantId_status_createdAt_idx` (`tenantId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Facility`
  ADD CONSTRAINT `Facility_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-000000000006', 'tenant.facilities.read', 'View facilities belonging to the tenant', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000007', 'tenant.facilities.create', 'Create facilities for the tenant', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000008', 'tenant.facilities.update', 'Update tenant facility details', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000009', 'tenant.facilities.suspend', 'Suspend an active tenant facility', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000010', 'tenant.facilities.activate', 'Activate a suspended tenant facility', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000011', 'tenant.facilities.deactivate', 'Permanently deactivate a tenant facility', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON (
    (`permission`.`code` = 'tenant.facilities.read' AND `role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER'))
    OR (`permission`.`code` IN (
      'tenant.facilities.create',
      'tenant.facilities.update',
      'tenant.facilities.suspend',
      'tenant.facilities.activate'
    ) AND `role`.`code` IN ('OWNER', 'ADMIN'))
    OR (`permission`.`code` = 'tenant.facilities.deactivate' AND `role`.`code` = 'OWNER')
  )
WHERE `role`.`isSystemRole` = TRUE;
