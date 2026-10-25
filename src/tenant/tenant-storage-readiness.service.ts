import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

export interface TenantStorageHealthProvider {
  checkReadiness(): Promise<boolean>;
}

export const TENANT_STORAGE_HEALTH_PROVIDER = Symbol('TENANT_STORAGE_HEALTH_PROVIDER');

@Injectable()
export class TenantStorageReadinessService implements OnApplicationBootstrap {
  constructor(
    private readonly config: ConfigService,
    @Inject(TENANT_STORAGE_HEALTH_PROVIDER)
    private readonly provider: TenantStorageHealthProvider,
  ) {}

  async checkReadiness(): Promise<boolean> {
    try {
      return await this.provider.checkReadiness();
    } catch {
      return false;
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.isProduction && !(await this.checkReadiness())) {
      throw new Error('Required tenant storage is unavailable');
    }
  }
}

@Injectable()
export class DevelopmentMemoryTenantStorageHealthProvider implements TenantStorageHealthProvider {
  async checkReadiness(): Promise<boolean> {
    return true;
  }
}

@Injectable()
export class UnconfiguredTenantStorageHealthProvider implements TenantStorageHealthProvider {
  async checkReadiness(): Promise<boolean> {
    return false;
  }
}
