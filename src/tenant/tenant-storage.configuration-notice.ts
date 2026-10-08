import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

@Injectable()
export class TenantStorageConfigurationNotice implements OnModuleInit {
  private readonly logger = new Logger(TenantStorageConfigurationNotice.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.config.isDevelopment) return;
    if (
      this.config.tenantStorageProvider === 'mongodb' &&
      this.config.tenantStorageMongoUri.trim().length > 0
    ) {
      return;
    }

    this.logger.warn(
      'Persistent tenant storage is not configured; tenant Patient requests will fail closed',
    );
  }
}
