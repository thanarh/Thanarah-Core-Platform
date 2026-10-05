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
    'TENANT_AUTHORIZATION_DENIED'
  ) NOT NULL;

CREATE TABLE `TenantPermission` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(128) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `TenantPermission_code_key` (`code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantRole` (
  `id` CHAR(36) NOT NULL,
  `tenantId` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `description` VARCHAR(512) NULL,
  `isSystemRole` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `TenantRole_tenantId_isSystemRole_idx` (`tenantId`, `isSystemRole`),
  UNIQUE INDEX `TenantRole_tenantId_code_key` (`tenantId`, `code`),
  UNIQUE INDEX `TenantRole_id_tenantId_key` (`id`, `tenantId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantRolePermission` (
  `tenantRoleId` CHAR(36) NOT NULL,
  `tenantPermissionId` CHAR(36) NOT NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TenantRolePermission_tenantPermissionId_idx` (`tenantPermissionId`),
  PRIMARY KEY (`tenantRoleId`, `tenantPermissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TenantMembershipRole` (
  `tenantId` CHAR(36) NOT NULL,
  `membershipId` CHAR(36) NOT NULL,
  `tenantRoleId` CHAR(36) NOT NULL,
  `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TenantMembershipRole_tenantId_tenantRoleId_idx` (`tenantId`, `tenantRoleId`),
  PRIMARY KEY (`membershipId`, `tenantRoleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `TenantMembership_id_tenantId_key`
  ON `TenantMembership` (`id`, `tenantId`);

ALTER TABLE `TenantRole`
  ADD CONSTRAINT `TenantRole_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TenantRolePermission`
  ADD CONSTRAINT `TenantRolePermission_tenantRoleId_fkey`
  FOREIGN KEY (`tenantRoleId`) REFERENCES `TenantRole` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TenantRolePermission`
  ADD CONSTRAINT `TenantRolePermission_tenantPermissionId_fkey`
  FOREIGN KEY (`tenantPermissionId`) REFERENCES `TenantPermission` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TenantMembershipRole`
  ADD CONSTRAINT `TenantMembershipRole_membershipId_tenantId_fkey`
  FOREIGN KEY (`membershipId`, `tenantId`) REFERENCES `TenantMembership` (`id`, `tenantId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `TenantMembershipRole`
  ADD CONSTRAINT `TenantMembershipRole_tenantRoleId_tenantId_fkey`
  FOREIGN KEY (`tenantRoleId`, `tenantId`) REFERENCES `TenantRole` (`id`, `tenantId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-000000000001', 'tenant.members.read', 'View tenant members and their assigned roles', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000002', 'tenant.members.roles.manage', 'Assign non-owner roles to tenant members', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000003', 'tenant.roles.read', 'View tenant roles and their permissions', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000004', 'tenant.roles.manage', 'Create tenant roles and update role metadata', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000005', 'tenant.roles.permissions.manage', 'Manage permissions assigned to custom tenant roles', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
