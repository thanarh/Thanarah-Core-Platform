-- AlterTable
ALTER TABLE `PlatformAuditLog` MODIFY `eventType` ENUM('AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT', 'AUTH_LOGOUT_ALL', 'TENANT_CREATED', 'TENANT_STATUS_CHANGED', 'TENANT_DEACTIVATED', 'TENANT_MEMBERSHIP_INVITED', 'TENANT_MEMBERSHIP_ACTIVATED', 'TENANT_MEMBERSHIP_SUSPENDED', 'TENANT_MEMBERSHIP_REMOVED') NOT NULL;

-- CreateTable
CREATE TABLE `TenantMembership` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `platformUserId` CHAR(36) NOT NULL,
    `status` ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED') NOT NULL DEFAULT 'INVITED',
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `activatedAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `removedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TenantMembership_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `TenantMembership_platformUserId_status_idx`(`platformUserId`, `status`),
    UNIQUE INDEX `TenantMembership_tenantId_platformUserId_key`(`tenantId`, `platformUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TenantMembership` ADD CONSTRAINT `TenantMembership_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantMembership` ADD CONSTRAINT `TenantMembership_platformUserId_fkey` FOREIGN KEY (`platformUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
