import { Injectable } from '@nestjs/common';
import type { Collection } from 'mongodb';
import type {
  PlatformLoginUserRecord,
  PlatformUserAuthRecord,
  PlatformUserPersistencePort,
} from '../persistence/platform-persistence.ports';
import {
  PlatformDocumentValidationError,
  PlatformMongoUnavailableError,
} from './platform-mongo.errors';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { platformUserSchema } from './platform-mongo.models';
import type { PlatformUserDocument } from './platform-mongo.models';

@Injectable()
export class MongoPlatformUserRepository implements PlatformUserPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  findAuthRecordById(id: string): Promise<PlatformUserAuthRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOne({ _id: id });
      if (!document) return null;
      const user = this.parse(document);
      return { id: user._id, status: user.status, tokenVersion: user.tokenVersion };
    });
  }

  findLoginRecordByEmail(email: string): Promise<PlatformLoginUserRecord | null> {
    return this.read(async (collection) => {
      const document = await collection.findOne(
        { email },
        { collation: { locale: 'en', strength: 1 } },
      );
      if (!document) return null;
      const user = this.parse(document);
      return {
        id: user._id,
        email: user.email,
        passwordHash: user.passwordHash,
        status: user.status,
        tokenVersion: user.tokenVersion,
        failedLoginAttempts: user.failedLoginAttempts,
        lockedUntil: user.lockedUntil,
      };
    });
  }

  async recordFailedLogin(
    id: string,
    threshold: number,
    lockMinutes: number,
  ): Promise<{ lockApplied: boolean }> {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + lockMinutes * 60_000);
    return this.write(async (collection) => {
      const user = await collection.findOneAndUpdate(
        { _id: id },
        [
          { $set: { failedLoginAttempts: { $add: ['$failedLoginAttempts', 1] } } },
          {
            $set: {
              lockedUntil: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$failedLoginAttempts', threshold] },
                      {
                        $or: [{ $eq: ['$lockedUntil', null] }, { $lte: ['$lockedUntil', now] }],
                      },
                    ],
                  },
                  lockedUntil,
                  '$lockedUntil',
                ],
              },
              updatedAt: now,
            },
          },
        ],
        { returnDocument: 'after' },
      );
      if (!user) return { lockApplied: false };
      this.parse(user);
      return { lockApplied: true };
    });
  }

  async resetFailedLogins(id: string): Promise<void> {
    await this.write(async (collection) => {
      const user = await collection.findOneAndUpdate(
        { _id: id },
        { $set: { failedLoginAttempts: 0, lockedUntil: null, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (!user) throw new PlatformDocumentValidationError();
      this.parse(user);
    });
  }

  private async read<T>(
    operation: (collection: Collection<PlatformUserDocument>) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await this.manager.getDatabase();
      return await operation(db.collection<PlatformUserDocument>('platform_users'));
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private async write<T>(
    operation: (collection: Collection<PlatformUserDocument>) => Promise<T>,
  ): Promise<T> {
    try {
      const db = await this.manager.getDatabase();
      return await operation(db.collection<PlatformUserDocument>('platform_users'));
    } catch (error) {
      if (error instanceof PlatformDocumentValidationError) throw error;
      throw new PlatformMongoUnavailableError();
    }
  }

  private parse(value: unknown): PlatformUserDocument {
    const parsed = platformUserSchema.safeParse(value);
    if (!parsed.success) throw new PlatformDocumentValidationError();
    return parsed.data;
  }
}
