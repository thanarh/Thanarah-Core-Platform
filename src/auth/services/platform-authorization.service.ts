import { Inject, Injectable } from '@nestjs/common';
import type { PlatformPermissionCode, PlatformRoleCode } from '../platform-authorization.constants';
import {
  PLATFORM_AUTHORIZATION_PERSISTENCE,
  type PlatformAuthorizationPersistencePort,
} from '../../persistence/platform-persistence.ports';

@Injectable()
export class PlatformAuthorizationService {
  constructor(
    @Inject(PLATFORM_AUTHORIZATION_PERSISTENCE)
    private readonly authorization: PlatformAuthorizationPersistencePort,
  ) {}

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
