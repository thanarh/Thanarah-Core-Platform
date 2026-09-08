CREATE TABLE `User` (
  `id` CHAR(36) NOT NULL,
  `email` VARCHAR(254) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `fullName` VARCHAR(191) NOT NULL,
  `status` ENUM('ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `tokenVersion` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `User_email_key` (`email`), INDEX `User_status_idx` (`status`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformSession` (
  `id` CHAR(36) NOT NULL, `userId` CHAR(36) NOT NULL, `refreshTokenHash` CHAR(64) NOT NULL,
  `tokenFamilyId` CHAR(36) NOT NULL,
  `status` ENUM('ACTIVE','REVOKED','EXPIRED','COMPROMISED') NOT NULL DEFAULT 'ACTIVE',
  `ipAddress` VARCHAR(45) NULL, `userAgent` VARCHAR(512) NULL, `deviceName` VARCHAR(191) NULL,
  `deviceType` VARCHAR(64) NULL, `browser` VARCHAR(128) NULL, `operatingSystem` VARCHAR(128) NULL,
  `countryCode` CHAR(2) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL, `revokedBy` CHAR(36) NULL, `revocationReason` VARCHAR(255) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `PlatformSession_refreshTokenHash_key` (`refreshTokenHash`),
  INDEX `PlatformSession_userId_status_idx` (`userId`,`status`),
  INDEX `PlatformSession_tokenFamilyId_idx` (`tokenFamilyId`), INDEX `PlatformSession_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `PlatformSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformRefreshTokenHistory` (
  `id` CHAR(36) NOT NULL, `sessionId` CHAR(36) NOT NULL, `tokenFamilyId` CHAR(36) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL, `rotatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL, `reuseDetectedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `PlatformRefreshTokenHistory_tokenHash_key` (`tokenHash`),
  INDEX `PlatformRefreshTokenHistory_sessionId_idx` (`sessionId`),
  INDEX `PlatformRefreshTokenHistory_tokenFamilyId_idx` (`tokenFamilyId`),
  INDEX `PlatformRefreshTokenHistory_expiresAt_idx` (`expiresAt`),
  CONSTRAINT `PlatformRefreshTokenHistory_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `PlatformSession` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;