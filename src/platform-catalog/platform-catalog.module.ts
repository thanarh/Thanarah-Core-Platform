import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { FEATURE_PERSISTENCE, PLAN_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { FeatureController } from './feature.controller';
import { FeatureService } from './feature.service';
import { PlanController } from './plan.controller';
import { PlanService } from './plan.service';
import { MongoPlatformFeatureRepository } from '../platform-mongo/mongo-platform-feature.repository';
import { MongoPlatformPlanRepository } from '../platform-mongo/mongo-platform-plan.repository';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformSecurityModule],
  controllers: [PlanController, FeatureController],
  providers: [
    MongoPlatformFeatureRepository,
    { provide: FEATURE_PERSISTENCE, useExisting: MongoPlatformFeatureRepository },
    MongoPlatformPlanRepository,
    { provide: PLAN_PERSISTENCE, useExisting: MongoPlatformPlanRepository },
    PlanService,
    FeatureService,
  ],
})
export class PlatformCatalogModule {}
