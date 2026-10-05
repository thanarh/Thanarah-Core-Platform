export const TENANT_PERMISSION_CODES = [
  'tenant.members.read',
  'tenant.members.roles.manage',
  'tenant.roles.read',
  'tenant.roles.manage',
  'tenant.roles.permissions.manage',
] as const;

export type TenantPermissionCode = (typeof TENANT_PERMISSION_CODES)[number];

export const TENANT_PERMISSION_DEFINITIONS: ReadonlyArray<{
  code: TenantPermissionCode;
  description: string;
}> = [
  { code: 'tenant.members.read', description: 'View tenant members and their assigned roles' },
  {
    code: 'tenant.members.roles.manage',
    description: 'Assign non-owner roles to tenant members',
  },
  { code: 'tenant.roles.read', description: 'View tenant roles and their permissions' },
  { code: 'tenant.roles.manage', description: 'Create tenant roles and update role metadata' },
  {
    code: 'tenant.roles.permissions.manage',
    description: 'Manage permissions assigned to custom tenant roles',
  },
];

export const TENANT_OWNER_PERMISSION_CODE: TenantPermissionCode = 'tenant.roles.permissions.manage';

export const DEFAULT_TENANT_ROLES = [
  {
    code: 'OWNER',
    name: 'Owner',
    description: 'Privileged tenant owner role',
    permissionCodes: TENANT_PERMISSION_CODES,
  },
  {
    code: 'ADMIN',
    name: 'Admin',
    description: 'Tenant administrator without ownership privileges',
    permissionCodes: [
      'tenant.members.read',
      'tenant.members.roles.manage',
      'tenant.roles.read',
      'tenant.roles.manage',
    ],
  },
  {
    code: 'MEMBER',
    name: 'Member',
    description: 'Read-only tenant member role',
    permissionCodes: ['tenant.members.read', 'tenant.roles.read'],
  },
] as const satisfies ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  permissionCodes: readonly TenantPermissionCode[];
}>;

export const TENANT_ROLE_PERMISSION_CODES = new Set<string>(TENANT_PERMISSION_CODES);
