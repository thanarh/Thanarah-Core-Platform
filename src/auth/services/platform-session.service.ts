import { Inject, Injectable } from '@nestjs/common';
import {
  PLATFORM_SESSION_PERSISTENCE,
  type CreatePlatformSessionRecord,
  type PlatformSessionPersistencePort,
  type PlatformSessionRecord,
} from '../../persistence/platform-persistence.ports';

@Injectable()
export class PlatformSessionService {
  constructor(
    @Inject(PLATFORM_SESSION_PERSISTENCE)
    private readonly repository: PlatformSessionPersistencePort,
  ) {}

  create(data: CreatePlatformSessionRecord): Promise<PlatformSessionRecord> {
    return this.repository.create(data);
  }
  findById(id: string): Promise<PlatformSessionRecord | null> {
    return this.repository.findById(id);
  }
  findByIdForUser(id: string, userId: string): Promise<PlatformSessionRecord | null> {
    return this.repository.findByIdForUser(id, userId);
  }
  listByUserId(userId: string): Promise<PlatformSessionRecord[]> {
    return this.repository.listByUserId(userId);
  }
  findActiveByUserId(userId: string): Promise<PlatformSessionRecord[]> {
    return this.repository.findActiveByUserId(userId);
  }
  findByRefreshTokenHash(hash: string): Promise<PlatformSessionRecord | null> {
    return this.repository.findByRefreshTokenHash(hash);
  }
  updateLastActivity(id: string): Promise<PlatformSessionRecord> {
    return this.repository.updateLastActivity(id);
  }
  revoke(id: string, by?: string, reason?: string): Promise<PlatformSessionRecord> {
    return this.repository.revoke(id, by, reason);
  }
  revokeOne(id: string, by?: string, reason?: string): Promise<PlatformSessionRecord | null> {
    return this.repository.revokeOne(id, by, reason);
  }
  revokeAllForUser(userId: string, by?: string, reason?: string): Promise<number> {
    return this.repository.revokeAllForUser(userId, by, reason);
  }
  revokeAll(userId: string, by?: string, reason?: string): Promise<number> {
    return this.repository.revokeAll(userId, by, reason);
  }
  markExpired(id: string): Promise<PlatformSessionRecord> {
    return this.repository.markExpired(id);
  }
  markCompromised(id: string): Promise<PlatformSessionRecord> {
    return this.repository.markCompromised(id);
  }
  findByTokenFamilyId(id: string): Promise<PlatformSessionRecord[]> {
    return this.repository.findByTokenFamilyId(id);
  }
  updateRefreshTokenHash(id: string, hash: string): Promise<PlatformSessionRecord> {
    return this.repository.updateRefreshTokenHash(id, hash);
  }
}
