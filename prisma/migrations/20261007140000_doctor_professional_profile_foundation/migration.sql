-- AlterTable
ALTER TABLE `Doctor` ADD COLUMN `bio` VARCHAR(2000) NULL,
    ADD COLUMN `professionalCode` VARCHAR(64) NULL,
    ADD COLUMN `professionalTitle` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Doctor_tenantId_professionalCode_key` ON `Doctor`(`tenantId`, `professionalCode`);
