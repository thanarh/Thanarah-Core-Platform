INSERT INTO `TenantPermission` (`id`, `code`, `description`, `createdAt`, `updatedAt`) VALUES
  ('451807c2-c408-484c-bb00-a840d2891201', 'tenant.subscriptions.read', 'Read the tenant SaaS subscription and its bank-transfer review status', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('451807c2-c408-484c-bb00-a840d2891202', 'tenant.subscriptions.payments.submit', 'Submit a bank-transfer receipt for the tenant SaaS subscription', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `TenantRolePermission` (`tenantRoleId`, `tenantPermissionId`, `assignedAt`)
SELECT `role`.`id`, `permission`.`id`, CURRENT_TIMESTAMP(3)
FROM `TenantRole` AS `role`
JOIN `TenantPermission` AS `permission`
  ON `permission`.`code` IN (
    'tenant.subscriptions.read',
    'tenant.subscriptions.payments.submit'
  )
WHERE `role`.`isSystemRole` = true
  AND `role`.`code` IN ('OWNER', 'ADMIN');
