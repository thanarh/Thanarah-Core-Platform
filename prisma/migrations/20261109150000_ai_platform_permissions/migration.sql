INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('4b9e4f6a-17d7-4b43-8fc7-00000000003f', 'tenant.ai.read', 'View tenant AI agents, knowledge sources, and usage', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000040', 'tenant.ai.manage', 'Create and update tenant AI agents and tool access', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000041', 'tenant.ai.knowledge.manage', 'Manage approved tenant knowledge sources for AI retrieval', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000042', 'tenant.ai.budget.manage', 'Configure tenant AI token budgets and limits', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('4b9e4f6a-17d7-4b43-8fc7-000000000043', 'tenant.ai.run', 'Run tenant AI agents within approved token limits', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `updatedAt` = CURRENT_TIMESTAMP(3);

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON `permission`.`code` IN (
    'tenant.ai.read',
    'tenant.ai.manage',
    'tenant.ai.knowledge.manage',
    'tenant.ai.budget.manage',
    'tenant.ai.run'
  )
WHERE `role`.`isSystemRole` = TRUE AND `role`.`code` IN ('OWNER', 'ADMIN');
