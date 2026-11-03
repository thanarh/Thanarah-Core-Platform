import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  HEALTHCARE_CATALOG_PERSISTENCE,
  SERVICE_CATALOG_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { HealthcareCatalogRepository } from './healthcare-catalog.repository';
import { ServiceCatalogRepository } from './service-catalog.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    HealthcareCatalogRepository,
    ServiceCatalogRepository,
    { provide: HEALTHCARE_CATALOG_PERSISTENCE, useExisting: HealthcareCatalogRepository },
    { provide: SERVICE_CATALOG_PERSISTENCE, useExisting: ServiceCatalogRepository },
  ],
  exports: [HEALTHCARE_CATALOG_PERSISTENCE, SERVICE_CATALOG_PERSISTENCE],
})
export class TenantCatalogPersistenceModule {}
