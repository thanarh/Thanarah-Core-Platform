import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformSecurityModule } from '../platform-security/platform-security.module';
import { FEATURE_PERSISTENCE, PLAN_PERSISTENCE } from '../persistence/platform-persistence.ports';
import { FeatureController } from './feature.controller';
import { FeatureRepository } from './feature.repository';
import { FeatureService } from './feature.service';
import { PlanController } from './plan.controller';
import { PlanRepository } from './plan.repository';
import { PlanService } from './plan.service';

@Module({
  imports: [AuthModule, DatabaseModule, PlatformSecurityModule],
  controllers: [PlanController, FeatureController],
  providers: [
    FeatureRepository,
    { provide: FEATURE_PERSISTENCE, useExisting: FeatureRepository },
    PlanRepository,
    { provide: PLAN_PERSISTENCE, useExisting: PlanRepository },
    PlanService,
    FeatureService,
  ],
})
export class PlatformCatalogModule {}
