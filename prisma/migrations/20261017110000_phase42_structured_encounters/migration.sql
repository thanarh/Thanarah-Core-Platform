INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`)
VALUES
  ('42000000-0000-4000-8000-000000000049', 'tenant.encounters.diagnoses.read', 'Read structured encounter diagnoses within encounter access scope', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('42000000-0000-4000-8000-000000000050', 'tenant.encounters.diagnoses.write', 'Create, update, and remove diagnoses on editable encounters', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('42000000-0000-4000-8000-000000000051', 'tenant.encounters.services.read', 'Read clinical service and procedure records on encounters', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('42000000-0000-4000-8000-000000000052', 'tenant.encounters.services.write', 'Create, update, and remove clinical service records on editable encounters', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('42000000-0000-4000-8000-000000000053', 'tenant.encounters.amendments.create', 'Open a reasoned amendment draft for a finalized encounter', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('42000000-0000-4000-8000-000000000054', 'tenant.encounters.amendments.update', 'Edit an open encounter amendment draft', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('42000000-0000-4000-8000-000000000055', 'tenant.encounters.amendments.finalize', 'Finalize an explicitly reasoned encounter amendment', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON `permission`.`code` IN (
    'tenant.encounters.diagnoses.read',
    'tenant.encounters.diagnoses.write',
    'tenant.encounters.services.read',
    'tenant.encounters.services.write',
    'tenant.encounters.amendments.create',
    'tenant.encounters.amendments.update',
    'tenant.encounters.amendments.finalize'
  )
WHERE `role`.`isSystemRole` = TRUE
  AND `role`.`code` = 'OWNER';
