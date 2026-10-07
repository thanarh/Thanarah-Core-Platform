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

CREATE TABLE `StaffRoleAssignment` (
  `tenantId` CHAR(36) NOT NULL,
  `staffId` CHAR(36) NOT NULL,
  `tenantRoleId` CHAR(36) NOT NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `StaffRoleAssignment_tenantId_staffId_idx` (`tenantId`, `staffId`),
  INDEX `StaffRoleAssignment_tenantId_tenantRoleId_idx` (`tenantId`, `tenantRoleId`),
  PRIMARY KEY (`staffId`, `tenantRoleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `Staff_id_tenantId_key` ON `Staff` (`id`, `tenantId`);

ALTER TABLE `StaffRoleAssignment`
  ADD CONSTRAINT `StaffRoleAssignment_staffId_tenantId_fkey`
  FOREIGN KEY (`staffId`, `tenantId`) REFERENCES `Staff` (`id`, `tenantId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StaffRoleAssignment`
  ADD CONSTRAINT `StaffRoleAssignment_tenantRoleId_tenantId_fkey`
  FOREIGN KEY (`tenantRoleId`, `tenantId`) REFERENCES `TenantRole` (`id`, `tenantId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-000000000020', 'tenant.staff.roles.read', 'View roles assigned to tenant staff profiles', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000021', 'tenant.staff.roles.manage', 'Assign and remove tenant roles for staff profiles', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON (
    (`permission`.`code` = 'tenant.staff.roles.read' AND `role`.`code` IN ('OWNER', 'ADMIN', 'MEMBER'))
    OR (`permission`.`code` = 'tenant.staff.roles.manage' AND `role`.`code` IN ('OWNER', 'ADMIN'))
  )
WHERE `role`.`isSystemRole` = TRUE;
