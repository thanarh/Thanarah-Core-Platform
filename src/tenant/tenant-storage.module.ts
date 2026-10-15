import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { DatabaseModule } from '../database/database.module';
import { TenantStorageConfigurationNotice } from './tenant-storage.configuration-notice';
import {
  OfficialTenantMongoClientFactory,
  TENANT_MONGO_CLIENT_FACTORY,
  TenantMongoClientManager,
} from './tenant-mongo-client.manager';
import { MongoTenantPatientStorage } from './mongo-tenant-patient.storage';
import { MongoTenantAppointmentStorage } from './mongo-tenant-appointment.storage';
import { TenantStorageActivationService } from './tenant-storage.activation.service';
import { PATIENT_REPOSITORY, TenantStoragePatientRepository } from './patient.repository';
import { TenantAppointmentRepository } from './appointment.repository';
import { APPOINTMENT_REPOSITORY } from './tenant-appointment.storage';
import {
  DevelopmentTenantDatabaseRegistry,
  TENANT_DATABASE_REGISTRY,
  TENANT_STORAGE_RESOLVER,
  TenantStorageResolverService,
  UnconfiguredTenantDatabaseRegistry,
} from './tenant-storage.resolver';
import {
  InMemoryTenantPatientStorage,
  TENANT_PATIENT_STORAGE,
  UnconfiguredTenantPatientStorage,
} from './tenant-patient.storage';
import type { TenantPatientStorage } from './tenant-patient.storage';
import { APPOINTMENT_STORAGE, type AppointmentStorage } from './tenant-appointment.storage';
import { InMemoryTenantAppointmentStorage } from './in-memory-tenant-appointment.storage';
import { UnconfiguredTenantAppointmentStorage } from './unconfigured-tenant-appointment.storage';
import type { TenantDatabaseRegistry } from './tenant-storage.contract';
import {
  TenantStorageRegistryService,
  TENANT_STORAGE_TARGET_RESOLVER,
} from './tenant-storage.registry';
import { effectiveTenantStorageProvider } from './tenant-storage.mode';

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    TenantStorageRegistryService,
    TenantStorageActivationService,
    {
      provide: TENANT_DATABASE_REGISTRY,
      inject: [ConfigService, TenantStorageRegistryService],
      useFactory: (
        config: ConfigService,
        registry: TenantStorageRegistryService,
      ): TenantDatabaseRegistry => {
        const provider = effectiveTenantStorageProvider(
          config.tenantStorageProvider,
          config.isDevelopment,
        );
        if (provider === 'mongodb') return registry;
        if (provider === 'memory') {
          return new DevelopmentTenantDatabaseRegistry();
        }
        return new UnconfiguredTenantDatabaseRegistry();
      },
    },
    {
      provide: TENANT_STORAGE_TARGET_RESOLVER,
      useExisting: TenantStorageRegistryService,
    },
    TenantStorageResolverService,
    {
      provide: TENANT_STORAGE_RESOLVER,
      useExisting: TenantStorageResolverService,
    },
    OfficialTenantMongoClientFactory,
    {
      provide: TENANT_MONGO_CLIENT_FACTORY,
      useExisting: OfficialTenantMongoClientFactory,
    },
    TenantMongoClientManager,
    MongoTenantPatientStorage,
    MongoTenantAppointmentStorage,
    TenantStorageConfigurationNotice,
    InMemoryTenantPatientStorage,
    UnconfiguredTenantPatientStorage,
    InMemoryTenantAppointmentStorage,
    UnconfiguredTenantAppointmentStorage,
    {
      provide: TENANT_PATIENT_STORAGE,
      inject: [
        ConfigService,
        MongoTenantPatientStorage,
        InMemoryTenantPatientStorage,
        UnconfiguredTenantPatientStorage,
      ],
      useFactory: (
        config: ConfigService,
        persistent: MongoTenantPatientStorage,
        memory: InMemoryTenantPatientStorage,
        unconfigured: UnconfiguredTenantPatientStorage,
      ): TenantPatientStorage => {
        const provider = effectiveTenantStorageProvider(
          config.tenantStorageProvider,
          config.isDevelopment,
        );
        if (provider === 'mongodb') return persistent;
        if (provider === 'memory') return memory;
        return unconfigured;
      },
    },
    TenantStoragePatientRepository,
    {
      provide: PATIENT_REPOSITORY,
      useExisting: TenantStoragePatientRepository,
    },
    {
      provide: APPOINTMENT_STORAGE,
      inject: [
        ConfigService,
        MongoTenantAppointmentStorage,
        InMemoryTenantAppointmentStorage,
        UnconfiguredTenantAppointmentStorage,
      ],
      useFactory: (
        config: ConfigService,
        persistent: MongoTenantAppointmentStorage,
        memory: InMemoryTenantAppointmentStorage,
        unconfigured: UnconfiguredTenantAppointmentStorage,
      ): AppointmentStorage => {
        const provider = effectiveTenantStorageProvider(
          config.tenantStorageProvider,
          config.isDevelopment,
        );
        if (provider === 'mongodb') return persistent;
        if (provider === 'memory') return memory;
        return unconfigured;
      },
    },
    TenantAppointmentRepository,
    {
      provide: APPOINTMENT_REPOSITORY,
      useExisting: TenantAppointmentRepository,
    },
  ],
  exports: [
    PATIENT_REPOSITORY,
    APPOINTMENT_REPOSITORY,
    TENANT_STORAGE_RESOLVER,
    TenantStorageRegistryService,
    TenantStorageActivationService,
    MongoTenantPatientStorage,
    MongoTenantAppointmentStorage,
  ],
})
export class TenantStorageModule {}
