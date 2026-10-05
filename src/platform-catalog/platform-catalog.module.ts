import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { FeatureController } from './feature.controller';
import { FeatureRepository } from './feature.repository';
import { FeatureService } from './feature.service';
import { PlanController } from './plan.controller';
import { PlanRepository } from './plan.repository';
import { PlanService } from './plan.service';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformSecurityModule],
  controllers: [PlanController, FeatureController],
  providers: [PlanRepository, PlanService, FeatureRepository, FeatureService],
})
export class PlatformCatalogModule {}
