import { Injectable } from '@nestjs/common';
import type { Prisma, PlatformAuditLog, PlatformSecurityEvent } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PlatformAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  createAuditLog(data: Prisma.PlatformAuditLogUncheckedCreateInput): Promise<PlatformAuditLog> {
    return this.prisma.platformAuditLog.create({ data });
  }

  createSecurityEvent(
    data: Prisma.PlatformSecurityEventUncheckedCreateInput,
  ): Promise<PlatformSecurityEvent> {
    return this.prisma.platformSecurityEvent.create({ data });
  }

  async resolveSecurityEvent(
    id: string,
    resolvedBy: string,
    resolutionNote?: string,
  ): Promise<boolean> {
    const result = await this.prisma.platformSecurityEvent.updateMany({
      where: { id, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy,
        resolutionNote,
      },
    });
    return result.count === 1;
  }
}
