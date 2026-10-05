-- AlterTable
ALTER TABLE `PlatformAuditLog` ADD COLUMN `subjectTenantId` CHAR(36) NULL,
    MODIFY `eventType` ENUM('AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT', 'AUTH_LOGOUT_ALL', 'TENANT_CREATED', 'TENANT_STATUS_CHANGED', 'TENANT_DEACTIVATED') NOT NULL;

-- CreateTable
CREATE TABLE `Tenant` (
    `id` CHAR(36) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `suspendedAt` DATETIME(3) NULL,
    `deactivatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tenant_slug_key`(`slug`),
    INDEX `Tenant_status_idx`(`status`),
    INDEX `Tenant_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `PlatformAuditLog_subjectTenantId_occurredAt_idx` ON `PlatformAuditLog`(`subjectTenantId`, `occurredAt`);

-- AddForeignKey
ALTER TABLE `PlatformAuditLog` ADD CONSTRAINT `PlatformAuditLog_subjectTenantId_fkey` FOREIGN KEY (`subjectTenantId`) REFERENCES `Tenant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
