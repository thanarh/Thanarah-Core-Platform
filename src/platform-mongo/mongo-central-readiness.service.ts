import { Injectable } from '@nestjs/common';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import { verifyPlatformMongoIndexes } from './platform-mongo.indexes';

@Injectable()
export class MongoCentralReadinessService {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  async isReady(): Promise<boolean> {
    if (!this.manager.configured) return false;
    try {
      const db = await this.manager.getDatabase();
      const hello = await db.command({ hello: 1 });
      if (
        (!hello.setName && hello.msg !== 'isdbgrid') ||
        typeof hello.logicalSessionTimeoutMinutes !== 'number'
      )
        return false;
      await verifyPlatformMongoIndexes(db);
      return true;
    } catch {
      return false;
    }
  }
}
