import { Injectable } from '@nestjs/common';
import type { PlatformRoleCode } from '../platform-authorization.constants';
import { PlatformAuthorizationService } from './platform-authorization.service';

/**
 * Keeps protected-role decisions separate from the general roles.assign permission.
 */
@Injectable()
export class PlatformRolePolicyService {
  constructor(private readonly authorization: PlatformAuthorizationService) {}

  async canAssignRole(actorUserId: string, targetRole: PlatformRoleCode): Promise<boolean> {
    const mayAssignRoles = await this.authorization.hasPermissions(actorUserId, ['roles.assign']);
    if (!mayAssignRoles) return false;
    if (targetRole !== 'OWNER') return true;
    const actorRoles = await this.authorization.getRoleCodes(actorUserId);
    return actorRoles.includes('OWNER');
  }
}
