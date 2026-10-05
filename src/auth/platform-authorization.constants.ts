export const PLATFORM_PERMISSION_CODES = [
  'platform.read',
  'platform.manage',
  'platform.settings.read',
  'platform.settings.manage',
  'platform_users.read',
  'platform_users.create',
  'platform_users.update',
  'platform_users.disable',
  'platform_users.enable',
  'platform_users.assign_roles',
  'roles.read',
  'roles.create',
  'roles.update',
  'roles.assign',
  'sessions.read',
  'sessions.revoke',
  'audit_logs.read',
  'security_events.read',
  'security_events.update',
  'security_events.resolve',
  'system_health.read',
  'plans.read',
  'plans.manage',
  'features.read',
  'features.manage',
  'plan_features.manage',
] as const;

export type PlatformPermissionCode = (typeof PLATFORM_PERMISSION_CODES)[number];

export const PLATFORM_ROLE_CODES = [
  'OWNER',
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'SECURITY_ADMIN',
  'SUPPORT_ADMIN',
] as const;

export type PlatformRoleCode = (typeof PLATFORM_ROLE_CODES)[number];
