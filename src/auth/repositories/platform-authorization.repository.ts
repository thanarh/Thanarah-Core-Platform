import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { PlatformPermissionCode, PlatformRoleCode } from '../platform-authorization.constants';
import type { PlatformAuthorizationPersistencePort } from '../../persistence/platform-persistence.ports';

@Injectable()
export class PlatformAuthorizationRepository implements PlatformAuthorizationPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async findRoleCodesByUserId(userId: string): Promise<PlatformRoleCode[]> {
    const assignments = await this.prisma.userPlatformRole.findMany({
      where: { userId },
      select: { role: { select: { code: true } } },
    });
    return assignments.map(({ role }) => role.code as PlatformRoleCode);
  }

  async findRoleIdsByUserId(userId: string): Promise<string[]> {
    const assignments = await this.prisma.userPlatformRole.findMany({
      where: { userId },
      select: { roleId: true },
    });
    return assignments.map(({ roleId }) => roleId);
  }

  async findPermissionCodesByUserId(userId: string): Promise<PlatformPermissionCode[]> {
    const assignments = await this.prisma.userPlatformRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            permissions: { select: { permission: { select: { code: true } } } },
          },
        },
      },
    });
    return [
      ...new Set(
        assignments.flatMap(({ role }) =>
          role.permissions.map(({ permission }) => permission.code as PlatformPermissionCode),
        ),
      ),
    ];
  }
}
