-- CreateTable
CREATE TABLE `TenantStorageTarget` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `provider` ENUM('MONGODB') NOT NULL DEFAULT 'MONGODB',
    `connectionReference` VARCHAR(64) NOT NULL DEFAULT 'primary',
    `databaseName` VARCHAR(63) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'INACTIVE',
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TenantStorageTarget_tenantId_status_isPrimary_createdAt_idx`(`tenantId`, `status`, `isPrimary`, `createdAt`),
    INDEX `TenantStorageTarget_provider_status_idx`(`provider`, `status`),
    UNIQUE INDEX `TenantStorageTarget_connectionReference_databaseName_key`(`connectionReference`, `databaseName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TenantStorageTarget` ADD CONSTRAINT `TenantStorageTarget_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
