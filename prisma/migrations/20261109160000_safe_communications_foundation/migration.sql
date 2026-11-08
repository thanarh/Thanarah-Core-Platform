INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('47000000-0000-4000-8000-000000000001', 'tenant.communications.read', 'View tenant communication policies, consents, providers, and delivery status', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('47000000-0000-4000-8000-000000000002', 'tenant.communications.manage', 'Configure tenant communication retention and retry policies', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('47000000-0000-4000-8000-000000000003', 'tenant.communications.consent.manage', 'Record and update tenant communication consent and opt-out preferences', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('47000000-0000-4000-8000-000000000004', 'tenant.communications.simulate', 'Run synthetic communication scenarios without external delivery', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON `permission`.`code` IN (
    'tenant.communications.read',
    'tenant.communications.manage',
    'tenant.communications.consent.manage',
    'tenant.communications.simulate'
  )
WHERE `role`.`isSystemRole` = TRUE
  AND `role`.`code` IN ('OWNER', 'ADMIN');
