import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from './database/prisma.service';
import { TenantStorageReadinessService } from './tenant/tenant-storage-readiness.service';
import { PlatformMongoClientManager } from './platform-mongo/platform-mongo.client.manager';

interface HealthResponse {
  status: string;
  timestamp: string;
}

interface ReadinessResponse extends HealthResponse {
  database: 'available';
  tenantStorage: 'available';
  platformMongo?: 'available';
}

@ApiTags('system')
@Controller()
export class AppController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantStorageReadinessService)
    private readonly tenantStorage: TenantStorageReadinessService,
    @Inject(PlatformMongoClientManager)
    private readonly platformMongo: PlatformMongoClientManager,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Application liveness check' })
  @ApiOkResponse({ description: 'The application process is running' })
  health(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Application and required storage readiness check' })
  @ApiOkResponse({ description: 'The application and required storage are ready' })
  @ApiServiceUnavailableResponse({ description: 'A required storage dependency is unavailable' })
  async ready(): Promise<ReadinessResponse> {
    if (!(await this.prisma.isReady())) {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Central database is unavailable',
      });
    }
    if (!(await this.tenantStorage.checkReadiness())) {
      throw new ServiceUnavailableException({
        code: 'TENANT_STORAGE_UNAVAILABLE',
        message: 'Required tenant storage is unavailable',
      });
    }
    if (!(await this.platformMongo.checkReadiness())) {
      throw new ServiceUnavailableException({
        code: 'PLATFORM_STORAGE_UNAVAILABLE',
        message: 'Platform storage is unavailable',
      });
    }

    return {
      status: 'ready',
      database: 'available',
      tenantStorage: 'available',
      ...(this.platformMongo.configured ? { platformMongo: 'available' as const } : {}),
      timestamp: new Date().toISOString(),
    };
  }
}
