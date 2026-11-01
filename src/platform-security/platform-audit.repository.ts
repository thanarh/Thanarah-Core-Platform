import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { PlatformAuditPersistencePort } from '../persistence/platform-persistence.ports';
import type {
  CreatePlatformAuditRecord,
  CreatePlatformSecurityRecord,
  PlatformAuditRecord,
  PlatformSecurityRecord,
} from '../persistence/platform-persistence.ports';

@Injectable()
export class PlatformAuditRepository implements PlatformAuditPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  createAuditLog(data: CreatePlatformAuditRecord): Promise<PlatformAuditRecord> {
    return this.prisma.platformAuditLog.create({ data });
  }

  findAuditLog(id: string): Promise<PlatformAuditRecord | null> {
    return this.prisma.platformAuditLog.findUnique({ where: { id } });
  }

  createSecurityEvent(data: CreatePlatformSecurityRecord): Promise<PlatformSecurityRecord> {
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
