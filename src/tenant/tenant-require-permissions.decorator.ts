import { SetMetadata } from '@nestjs/common';
import type { TenantPermissionCode } from './tenant-authorization.constants';

export const TENANT_REQUIRED_PERMISSIONS = 'tenant:required-permissions';

export const RequireTenantPermissions = (
  ...permissions: TenantPermissionCode[]
): MethodDecorator & ClassDecorator => SetMetadata(TENANT_REQUIRED_PERMISSIONS, permissions);
