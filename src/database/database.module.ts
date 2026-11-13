import { Module } from '@nestjs/common';
import { PlatformMongoModule } from '../platform-mongo/platform-mongo.module';
import { MongoCentralReadinessService } from '../platform-mongo/mongo-central-readiness.service';
import { MongoEncounterOperationStore } from '../platform-mongo/mongo-encounter-operation.store';

@Module({
  imports: [PlatformMongoModule],
  providers: [MongoCentralReadinessService, MongoEncounterOperationStore],
  exports: [PlatformMongoModule, MongoCentralReadinessService, MongoEncounterOperationStore],
})
export class DatabaseModule {}
