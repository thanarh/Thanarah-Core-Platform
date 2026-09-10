CREATE TABLE `PlatformAuditLog` (
    `id` CHAR(36) NOT NULL,
    `eventType` ENUM('AUTH_LOGIN_SUCCEEDED', 'AUTH_LOGOUT', 'AUTH_LOGOUT_ALL') NOT NULL,
    `actorUserId` CHAR(36) NULL,
    `subjectUserId` CHAR(36) NULL,
    `sessionId` CHAR(36) NULL,
    `requestId` VARCHAR(128) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `metadata` JSON NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PlatformAuditLog_eventType_occurredAt_idx`(`eventType`, `occurredAt`),
    INDEX `PlatformAuditLog_actorUserId_occurredAt_idx`(`actorUserId`, `occurredAt`),
    INDEX `PlatformAuditLog_subjectUserId_occurredAt_idx`(`subjectUserId`, `occurredAt`),
    INDEX `PlatformAuditLog_sessionId_occurredAt_idx`(`sessionId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformSecurityEvent` (
    `id` CHAR(36) NOT NULL,
    `eventType` ENUM('AUTH_LOGIN_FAILED', 'AUTH_ACCOUNT_LOCKED', 'AUTH_REFRESH_TOKEN_REUSE', 'AUTH_REFRESH_SESSION_COMPROMISED', 'AUTHORIZATION_DENIED') NOT NULL,
    `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `actorUserId` CHAR(36) NULL,
    `subjectUserId` CHAR(36) NULL,
    `sessionId` CHAR(36) NULL,
    `requestId` VARCHAR(128) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `metadata` JSON NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,
    `resolvedBy` CHAR(36) NULL,
    `resolutionNote` VARCHAR(1000) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlatformSecurityEvent_eventType_status_occurredAt_idx`(`eventType`, `status`, `occurredAt`),
    INDEX `PlatformSecurityEvent_actorUserId_occurredAt_idx`(`actorUserId`, `occurredAt`),
    INDEX `PlatformSecurityEvent_subjectUserId_occurredAt_idx`(`subjectUserId`, `occurredAt`),
    INDEX `PlatformSecurityEvent_sessionId_occurredAt_idx`(`sessionId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformAuditLog`
    ADD CONSTRAINT `PlatformAuditLog_actorUserId_fkey`
    FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `PlatformAuditLog_subjectUserId_fkey`
    FOREIGN KEY (`subjectUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PlatformSecurityEvent`
    ADD CONSTRAINT `PlatformSecurityEvent_actorUserId_fkey`
    FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `PlatformSecurityEvent_subjectUserId_fkey`
    FOREIGN KEY (`subjectUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `PlatformSecurityEvent_resolvedBy_fkey`
    FOREIGN KEY (`resolvedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;