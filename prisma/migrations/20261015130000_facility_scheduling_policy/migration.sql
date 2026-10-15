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
    'STAFF_FACILITY_ASSIGNED',
    'STAFF_FACILITY_UNASSIGNED',
    'STAFF_BRANCH_ASSIGNED',
    'STAFF_BRANCH_UNASSIGNED',
    'DEPARTMENT_CREATED',
    'DEPARTMENT_UPDATED',
    'DEPARTMENT_ACTIVATED',
    'DEPARTMENT_SUSPENDED',
    'DEPARTMENT_DEACTIVATED',
    'SPECIALTY_CREATED',
    'SPECIALTY_UPDATED',
    'SPECIALTY_ACTIVATED',
    'SPECIALTY_SUSPENDED',
    'SPECIALTY_DEACTIVATED',
    'SERVICE_CREATED',
    'SERVICE_UPDATED',
    'SERVICE_STATUS_CHANGED',
    'DOCTOR_CREATED',
    'DOCTOR_UPDATED',
    'DOCTOR_ACTIVATED',
    'DOCTOR_SUSPENDED',
    'DOCTOR_DEACTIVATED',
    'DOCTOR_DEPARTMENT_ASSIGNED',
    'DOCTOR_DEPARTMENT_UNASSIGNED',
    'DOCTOR_SPECIALTY_ASSIGNED',
    'DOCTOR_SPECIALTY_UNASSIGNED',
    'PATIENT_CREATED',
    'PATIENT_UPDATED',
    'PATIENT_STATUS_CHANGED',
    'APPOINTMENT_CREATED',
    'APPOINTMENT_UPDATED',
    'APPOINTMENT_RESCHEDULED',
    'APPOINTMENT_CANCELLED',
    'SCHEDULING_POLICY_CREATED',
    'SCHEDULING_POLICY_UPDATED',
    'SCHEDULING_POLICY_ACTIVATED',
    'SCHEDULING_POLICY_DEACTIVATED',
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

CREATE TABLE `FacilitySchedulingPolicy` (
  `id` CHAR(36) NOT NULL,
  `tenantId` CHAR(36) NOT NULL,
  `facilityId` CHAR(36) NOT NULL,
  `status` ENUM('INACTIVE', 'ACTIVE') NOT NULL DEFAULT 'INACTIVE',
  `timeZone` VARCHAR(64) NOT NULL,
  `rules` JSON NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `FacilitySchedulingPolicy_facilityId_tenantId_key` (`facilityId`, `tenantId`),
  UNIQUE INDEX `FacilitySchedulingPolicy_id_tenantId_key` (`id`, `tenantId`),
  INDEX `FacilitySchedulingPolicy_tenantId_status_idx` (`tenantId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FacilitySchedulingPolicyRevision` (
  `id` CHAR(36) NOT NULL,
  `policyId` CHAR(36) NOT NULL,
  `tenantId` CHAR(36) NOT NULL,
  `facilityId` CHAR(36) NOT NULL,
  `version` INTEGER NOT NULL,
  `action` ENUM('CREATED', 'UPDATED', 'ACTIVATED', 'DEACTIVATED') NOT NULL,
  `status` ENUM('INACTIVE', 'ACTIVE') NOT NULL,
  `timeZone` VARCHAR(64) NOT NULL,
  `rules` JSON NOT NULL,
  `actorUserId` CHAR(36) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `FacilitySchedulingPolicyRevision_policyId_version_key` (`policyId`, `version`),
  INDEX `FacilitySchedPolicyRevision_tenant_fac_created_idx` (`tenantId`, `facilityId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FacilitySchedulingPolicy`
  ADD CONSTRAINT `FacilitySchedulingPolicy_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `FacilitySchedulingPolicy_facilityId_tenantId_fkey`
  FOREIGN KEY (`facilityId`, `tenantId`) REFERENCES `Facility` (`id`, `tenantId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `FacilitySchedulingPolicyRevision`
  ADD CONSTRAINT `FacilitySchedulingPolicyRevision_policyId_tenantId_fkey`
  FOREIGN KEY (`policyId`, `tenantId`) REFERENCES `FacilitySchedulingPolicy` (`id`, `tenantId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES (
  '4b9e4f6a-17d7-4b43-8fc7-000000000039',
  'tenant.appointments.policy.manage',
  'Configure and audit facility appointment scheduling policies',
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
);

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON `permission`.`code` = 'tenant.appointments.policy.manage'
WHERE `role`.`isSystemRole` = TRUE
  AND `role`.`code` IN ('OWNER', 'ADMIN');
