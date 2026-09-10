import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type PlatformUserAuthRecord = Pick<User, 'id' | 'status' | 'tokenVersion'>;
export type LoginUserRecord = Pick<
  User,
  | 'id'
  | 'email'
  | 'passwordHash'
  | 'status'
  | 'tokenVersion'
  | 'failedLoginAttempts'
  | 'lockedUntil'
>;

@Injectable()
export class PlatformUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAuthRecordById(id: string): Promise<PlatformUserAuthRecord | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true, tokenVersion: true },
    });
  }

  findLoginRecordByEmail(email: string): Promise<LoginUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        tokenVersion: true,
        failedLoginAttempts: true,
        lockedUntil: true,
      },
    });
  }

  async recordFailedLogin(
    id: string,
    threshold: number,
    lockMinutes: number,
  ): Promise<{ lockApplied: boolean }> {
    return this.prisma.$transaction(async (transaction) => {
      const lockResult = await transaction.user.updateMany({
        where: { id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      await transaction.user.updateMany({
        where: {
          id,
          failedLoginAttempts: { gte: threshold },
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
        },
        data: { lockedUntil: new Date(Date.now() + lockMinutes * 60000) },
      });
      return { lockApplied: lockResult.count === 1 };
    });
  }

  resetFailedLogins(id: string): Promise<void> {
    return this.prisma.user
      .update({
        where: { id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      })
      .then(() => undefined);
  }
}
