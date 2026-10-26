import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '../config/config.service';

/**
 * PrismaService wraps PrismaClient for NestJS lifecycle management.
 *
 * Connection behaviour:
 *  - Production/staging use DATABASE_URL.
 *  - Development uses MYSQL_DATABASE_URL so Replit's managed PostgreSQL
 *    DATABASE_URL is never mistaken for this MySQL datasource.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private _connected = false;
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    const databaseUrl = config.databaseUrl;
    super(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : {});
    this.config = config;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.databaseUrl) {
      this.logger.warn(
        'Development MySQL connection is not configured — running without a database connection',
      );
      return;
    }

    try {
      await this.$connect();
      this._connected = true;
      this.logger.log('Database connection established');
    } catch {
      this._connected = false;
      if (this.config.isProduction) {
        this.logger.error('Central database connection failed during production startup');
        throw new Error('Central database connection failed');
      }
      this.logger.warn('Database connection unavailable — continuing in development mode');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this._connected) {
      await this.$disconnect();
      this._connected = false;
    }
  }

  isConnected(): boolean {
    return this._connected;
  }

  async isReady(): Promise<boolean> {
    if (!this.config.databaseUrl) return false;

    try {
      await this.$queryRaw(Prisma.sql`SELECT 1`);
      this._connected = true;
      return true;
    } catch {
      this._connected = false;
      this.logger.warn('Central database readiness check failed');
      return false;
    }
  }
}
