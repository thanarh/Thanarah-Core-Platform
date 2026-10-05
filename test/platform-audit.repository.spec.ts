import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service';
import { PlatformAuditRepository } from '../src/platform-security/platform-audit.repository';

describe('PlatformAuditRepository.resolveSecurityEvent', () => {
  it('only resolves OPEN events and reports whether exactly one row changed', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      platformSecurityEvent: { updateMany },
    } as unknown as PrismaService;
    const repository = new PlatformAuditRepository(prisma);

    await expect(
      repository.resolveSecurityEvent('event-id', 'authenticated-user', 'Reviewed'),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'event-id', status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedAt: expect.any(Date),
        resolvedBy: 'authenticated-user',
        resolutionNote: 'Reviewed',
      },
    });
  });

  it('returns false when the event is already resolved or does not exist', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      platformSecurityEvent: { updateMany },
    } as unknown as PrismaService;
    const repository = new PlatformAuditRepository(prisma);

    await expect(repository.resolveSecurityEvent('event-id', 'authenticated-user')).resolves.toBe(
      false,
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'event-id', status: 'OPEN' } }),
    );
  });
});
