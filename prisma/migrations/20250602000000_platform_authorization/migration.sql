CREATE TABLE `PlatformRole` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PlatformRole_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformPermission` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(128) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PlatformPermission_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UserPlatformRole` (
  `userId` CHAR(36) NOT NULL,
  `roleId` CHAR(36) NOT NULL,
  PRIMARY KEY (`userId`, `roleId`),
  INDEX `UserPlatformRole_roleId_idx` (`roleId`),
  CONSTRAINT `UserPlatformRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `UserPlatformRole_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `PlatformRole` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformRolePermission` (
  `roleId` CHAR(36) NOT NULL,
  `permissionId` CHAR(36) NOT NULL,
  PRIMARY KEY (`roleId`, `permissionId`),
  INDEX `PlatformRolePermission_permissionId_idx` (`permissionId`),
  CONSTRAINT `PlatformRolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `PlatformRole` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PlatformRolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `PlatformPermission` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `PlatformPermission` (`id`, `code`, `updatedAt`) VALUES
  (UUID(), 'platform.read', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform.manage', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform.settings.read', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform.settings.manage', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform_users.read', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform_users.create', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform_users.update', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform_users.disable', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform_users.enable', CURRENT_TIMESTAMP(3)),
  (UUID(), 'platform_users.assign_roles', CURRENT_TIMESTAMP(3)),
  (UUID(), 'roles.read', CURRENT_TIMESTAMP(3)),
  (UUID(), 'roles.create', CURRENT_TIMESTAMP(3)),
  (UUID(), 'roles.update', CURRENT_TIMESTAMP(3)),
  (UUID(), 'roles.assign', CURRENT_TIMESTAMP(3)),
  (UUID(), 'sessions.read', CURRENT_TIMESTAMP(3)),
  (UUID(), 'sessions.revoke', CURRENT_TIMESTAMP(3)),
  (UUID(), 'audit_logs.read', CURRENT_TIMESTAMP(3)),
  (UUID(), 'security_events.read', CURRENT_TIMESTAMP(3)),
  (UUID(), 'security_events.update', CURRENT_TIMESTAMP(3)),
  (UUID(), 'security_events.resolve', CURRENT_TIMESTAMP(3)),
  (UUID(), 'system_health.read', CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

INSERT INTO `PlatformRole` (`id`, `code`, `updatedAt`) VALUES
  (UUID(), 'OWNER', CURRENT_TIMESTAMP(3)),
  (UUID(), 'SUPER_ADMIN', CURRENT_TIMESTAMP(3)),
  (UUID(), 'PLATFORM_ADMIN', CURRENT_TIMESTAMP(3)),
  (UUID(), 'SECURITY_ADMIN', CURRENT_TIMESTAMP(3)),
  (UUID(), 'SUPPORT_ADMIN', CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `code` = VALUES(`code`);

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
CROSS JOIN `PlatformPermission` AS `permission`
WHERE `role`.`code` IN ('OWNER', 'SUPER_ADMIN');

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
JOIN `PlatformPermission` AS `permission` ON `permission`.`code` IN (
  'platform.read', 'platform_users.read', 'platform_users.create',
  'platform_users.update', 'platform_users.disable', 'platform_users.enable',
  'platform_users.assign_roles', 'roles.read', 'roles.assign'
)
WHERE `role`.`code` = 'PLATFORM_ADMIN';

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
JOIN `PlatformPermission` AS `permission` ON `permission`.`code` IN (
  'sessions.read', 'sessions.revoke', 'audit_logs.read',
  'security_events.read', 'security_events.update', 'security_events.resolve',
  'system_health.read'
)
WHERE `role`.`code` = 'SECURITY_ADMIN';

INSERT IGNORE INTO `PlatformRolePermission` (`roleId`, `permissionId`)
SELECT `role`.`id`, `permission`.`id`
FROM `PlatformRole` AS `role`
JOIN `PlatformPermission` AS `permission` ON `permission`.`code` IN (
  'platform.read', 'platform_users.read', 'system_health.read'
)
WHERE `role`.`code` = 'SUPPORT_ADMIN';