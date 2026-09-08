import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export type PlatformUserAuthRecord = Pick<User, 'id' | 'status' | 'tokenVersion'>;

@Injectable()
export class PlatformUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAuthRecordById(id: string): Promise<PlatformUserAuthRecord | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, status: true, tokenVersion: true },
    });
  }
}
