import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import {
  OfficialPlatformMongoClientFactory,
  PLATFORM_MONGO_CLIENT_FACTORY,
  PlatformMongoClientManager,
} from './platform-mongo.client.manager';
import { PlatformMongoRepositories } from './platform-mongo.repositories';

@Module({
  imports: [ConfigModule],
  providers: [
    OfficialPlatformMongoClientFactory,
    {
      provide: PLATFORM_MONGO_CLIENT_FACTORY,
      useExisting: OfficialPlatformMongoClientFactory,
    },
    PlatformMongoClientManager,
    PlatformMongoRepositories,
  ],
  exports: [PlatformMongoClientManager, PlatformMongoRepositories],
})
export class PlatformMongoModule {}
