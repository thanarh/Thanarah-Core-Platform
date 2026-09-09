import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from './database/prisma.service';

interface HealthResponse {
  status: string;
  timestamp: string;
}

interface ReadinessResponse extends HealthResponse {
  database: 'available';
}

@ApiTags('system')
@Controller()
export class AppController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
  @ApiOperation({ summary: 'Central database readiness check' })
  @ApiOkResponse({ description: 'The application and central database are ready' })
  @ApiServiceUnavailableResponse({ description: 'The central database is unavailable' })
  async ready(): Promise<ReadinessResponse> {
    if (!(await this.prisma.isReady())) {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Central database is unavailable',
      });
    }

    return {
      status: 'ready',
      database: 'available',
      timestamp: new Date().toISOString(),
    };
  }
}
