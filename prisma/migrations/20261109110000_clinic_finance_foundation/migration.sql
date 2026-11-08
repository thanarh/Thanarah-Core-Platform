INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-00000000003a', 'tenant.finance.read', 'Read clinic invoices and finance settings', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-00000000003b', 'tenant.finance.manage', 'Create and update clinic invoice drafts', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-00000000003c', 'tenant.finance.settings.manage', 'Configure clinic invoice currency, fields, taxes, and numbering', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-00000000003d', 'tenant.finance.review', 'Review clinic invoice drafts before issue', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-00000000003e', 'tenant.finance.issue', 'Issue reviewed clinic invoices without collecting payment', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON `permission`.`code` IN (
    'tenant.finance.read',
    'tenant.finance.manage',
    'tenant.finance.settings.manage',
    'tenant.finance.review',
    'tenant.finance.issue'
  )
WHERE `role`.`isSystemRole` = TRUE AND `role`.`code` IN ('OWNER', 'ADMIN');
