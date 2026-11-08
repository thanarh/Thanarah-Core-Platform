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
import { MongoTenantEncounterStorage } from './mongo-tenant-encounter.storage';
import { MongoTenantClinicFinanceStorage } from './mongo-tenant-clinic-finance.storage';
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
import {
  DevelopmentMemoryTenantStorageHealthProvider,
  TENANT_STORAGE_HEALTH_PROVIDER,
  TenantStorageReadinessService,
  UnconfiguredTenantStorageHealthProvider,
} from './tenant-storage-readiness.service';
import type { TenantStorageHealthProvider } from './tenant-storage-readiness.service';
import { InMemoryTenantEncounterStorage } from './in-memory-tenant-encounter.storage';
import { UnconfiguredTenantEncounterStorage } from './unconfigured-tenant-encounter.storage';
import { TenantStorageEncounterRepository } from './encounter.repository';
import { ENCOUNTER_REPOSITORY, ENCOUNTER_STORAGE } from './tenant-encounter.storage';
import type { EncounterStorage } from './tenant-encounter.storage';
import {
  CLINIC_FINANCE_STORAGE,
  InMemoryClinicFinanceStorage,
  UnconfiguredClinicFinanceStorage,
} from './tenant-clinic-finance.storage';
import type { ClinicFinanceStorage } from './tenant-clinic-finance.storage';

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
    TenantStorageReadinessService,
    DevelopmentMemoryTenantStorageHealthProvider,
    UnconfiguredTenantStorageHealthProvider,
    {
      provide: TENANT_STORAGE_HEALTH_PROVIDER,
      inject: [
        ConfigService,
        TenantMongoClientManager,
        DevelopmentMemoryTenantStorageHealthProvider,
        UnconfiguredTenantStorageHealthProvider,
      ],
      useFactory: (
        config: ConfigService,
        mongo: TenantMongoClientManager,
        memory: DevelopmentMemoryTenantStorageHealthProvider,
        unconfigured: UnconfiguredTenantStorageHealthProvider,
      ): TenantStorageHealthProvider => {
        const provider = effectiveTenantStorageProvider(
          config.tenantStorageProvider,
          config.isDevelopment,
        );
        if (provider === 'mongodb') return mongo;
        if (provider === 'memory') return memory;
        return unconfigured;
      },
    },
    MongoTenantPatientStorage,
    MongoTenantAppointmentStorage,
    MongoTenantEncounterStorage,
    MongoTenantClinicFinanceStorage,
    TenantStorageConfigurationNotice,
    InMemoryTenantPatientStorage,
    UnconfiguredTenantPatientStorage,
    InMemoryTenantAppointmentStorage,
    UnconfiguredTenantAppointmentStorage,
    InMemoryTenantEncounterStorage,
    UnconfiguredTenantEncounterStorage,
    InMemoryClinicFinanceStorage,
    UnconfiguredClinicFinanceStorage,
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
    {
      provide: ENCOUNTER_STORAGE,
      inject: [
        ConfigService,
        MongoTenantEncounterStorage,
        InMemoryTenantEncounterStorage,
        UnconfiguredTenantEncounterStorage,
      ],
      useFactory: (
        config: ConfigService,
        persistent: MongoTenantEncounterStorage,
        memory: InMemoryTenantEncounterStorage,
        unconfigured: UnconfiguredTenantEncounterStorage,
      ): EncounterStorage => {
        const provider = effectiveTenantStorageProvider(
          config.tenantStorageProvider,
          config.isDevelopment,
        );
        if (provider === 'mongodb') return persistent;
        if (provider === 'memory') return memory;
        return unconfigured;
      },
    },
    {
      provide: CLINIC_FINANCE_STORAGE,
      inject: [
        ConfigService,
        MongoTenantClinicFinanceStorage,
        InMemoryClinicFinanceStorage,
        UnconfiguredClinicFinanceStorage,
      ],
      useFactory: (
        config: ConfigService,
        persistent: MongoTenantClinicFinanceStorage,
        memory: InMemoryClinicFinanceStorage,
        unconfigured: UnconfiguredClinicFinanceStorage,
      ): ClinicFinanceStorage => {
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
    TenantStorageEncounterRepository,
    {
      provide: ENCOUNTER_REPOSITORY,
      useExisting: TenantStorageEncounterRepository,
    },
  ],
  exports: [
    PATIENT_REPOSITORY,
    APPOINTMENT_REPOSITORY,
    ENCOUNTER_REPOSITORY,
    TENANT_STORAGE_RESOLVER,
    TenantStorageRegistryService,
    TenantStorageActivationService,
    TenantStorageReadinessService,
    MongoTenantPatientStorage,
    MongoTenantAppointmentStorage,
    MongoTenantEncounterStorage,
    CLINIC_FINANCE_STORAGE,
    MongoTenantClinicFinanceStorage,
  ],
})
export class TenantStorageModule {}
