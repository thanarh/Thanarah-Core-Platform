import { Injectable } from '@nestjs/common';
import type { PlatformSession } from '@prisma/client';
import {
  PlatformSessionRepository,
  type CreatePlatformSessionInput,
} from '../repositories/platform-session.repository';

@Injectable()
export class PlatformSessionService {
  constructor(private readonly repository: PlatformSessionRepository) {}

  create(data: CreatePlatformSessionInput): Promise<PlatformSession> {
    return this.repository.create(data);
  }
  findById(id: string): Promise<PlatformSession | null> {
    return this.repository.findById(id);
  }
  findByIdForUser(id: string, userId: string): Promise<PlatformSession | null> {
    return this.repository.findByIdForUser(id, userId);
  }
  listByUserId(userId: string): Promise<PlatformSession[]> {
    return this.repository.listByUserId(userId);
  }
  findActiveByUserId(userId: string): Promise<PlatformSession[]> {
    return this.repository.findActiveByUserId(userId);
  }
  findByRefreshTokenHash(hash: string): Promise<PlatformSession | null> {
    return this.repository.findByRefreshTokenHash(hash);
  }
  updateLastActivity(id: string): Promise<PlatformSession> {
    return this.repository.updateLastActivity(id);
  }
  revoke(id: string, by?: string, reason?: string): Promise<PlatformSession> {
    return this.repository.revoke(id, by, reason);
  }
  revokeOne(id: string, by?: string, reason?: string): Promise<PlatformSession | null> {
    return this.repository.revokeOne(id, by, reason);
  }
  revokeAllForUser(userId: string, by?: string, reason?: string): Promise<number> {
    return this.repository.revokeAllForUser(userId, by, reason);
  }
  revokeAll(userId: string, by?: string, reason?: string): Promise<number> {
    return this.repository.revokeAll(userId, by, reason);
  }
  markExpired(id: string): Promise<PlatformSession> {
    return this.repository.markExpired(id);
  }
  markCompromised(id: string): Promise<PlatformSession> {
    return this.repository.markCompromised(id);
  }
  findByTokenFamilyId(id: string): Promise<PlatformSession[]> {
    return this.repository.findByTokenFamilyId(id);
  }
  updateRefreshTokenHash(id: string, hash: string): Promise<PlatformSession> {
    return this.repository.updateRefreshTokenHash(id, hash);
  }
}
