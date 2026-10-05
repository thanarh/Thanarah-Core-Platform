import { Injectable } from '@nestjs/common';
import type { PlatformPermissionCode, PlatformRoleCode } from '../platform-authorization.constants';
import { PlatformAuthorizationRepository } from '../repositories/platform-authorization.repository';

@Injectable()
export class PlatformAuthorizationService {
  constructor(private readonly authorization: PlatformAuthorizationRepository) {}

  async hasPermissions(
    userId: string,
    requiredPermissions: readonly PlatformPermissionCode[],
  ): Promise<boolean> {
    if (requiredPermissions.length === 0) return true;
    const grantedPermissions = await this.authorization.findPermissionCodesByUserId(userId);
    const granted = new Set(grantedPermissions);
    return requiredPermissions.every((permission) => granted.has(permission));
  }

  getRoleCodes(userId: string): Promise<PlatformRoleCode[]> {
    return this.authorization.findRoleCodesByUserId(userId);
  }

  getRoleIdsByUserId(userId: string): Promise<string[]> {
    return this.authorization.findRoleIdsByUserId(userId);
  }
}
