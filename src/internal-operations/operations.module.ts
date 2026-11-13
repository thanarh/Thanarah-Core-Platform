import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformMongoModule } from '../platform-mongo/platform-mongo.module';
import { OperationsController } from './operations.controller';
import { OperationsStore } from './operations.store';
import { OperationsRecords } from './operations.records';
import { OperationsFinance } from './operations.finance';
import { OperationsActions } from './operations.actions';
import { OperationsService } from './operations.service';

@Module({
  imports: [AuthModule, PlatformMongoModule],
  controllers: [OperationsController],
  providers: [
    OperationsStore,
    OperationsRecords,
    OperationsFinance,
    OperationsActions,
    OperationsService,
  ],
  exports: [OperationsStore],
})
export class OperationsModule {}
