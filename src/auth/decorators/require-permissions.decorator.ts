import { SetMetadata } from '@nestjs/common';
import { REQUIRED_PERMISSIONS_KEY } from '../auth.constants';
import type { PlatformPermissionCode } from '../platform-authorization.constants';

export const RequirePermissions = (
  ...permissions: PlatformPermissionCode[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
