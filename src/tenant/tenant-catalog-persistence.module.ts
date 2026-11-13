import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  HEALTHCARE_CATALOG_PERSISTENCE,
  SERVICE_CATALOG_PERSISTENCE,
} from '../persistence/platform-persistence.ports';
import { MongoHealthcareCatalogRepository } from '../platform-mongo/mongo-healthcare-catalog.repository';
import { MongoServiceCatalogRepository } from '../platform-mongo/mongo-service-catalog.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    MongoHealthcareCatalogRepository,
    MongoServiceCatalogRepository,
    { provide: HEALTHCARE_CATALOG_PERSISTENCE, useExisting: MongoHealthcareCatalogRepository },
    { provide: SERVICE_CATALOG_PERSISTENCE, useExisting: MongoServiceCatalogRepository },
  ],
  exports: [HEALTHCARE_CATALOG_PERSISTENCE, SERVICE_CATALOG_PERSISTENCE],
})
export class TenantCatalogPersistenceModule {}
