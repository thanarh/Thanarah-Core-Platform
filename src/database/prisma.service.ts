import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '../config/config.service';

/**
 * PrismaService wraps PrismaClient for NestJS lifecycle management.
 *
 * Connection behaviour:
 *  - Production (cPanel): DATABASE_URL is set in the Node.js app environment;
 *    the client connects normally on module init.
 *  - Replit development: DATABASE_URL may be absent. The service stays
 *    operational with isConnected() returning false so non-database development
 *    workflows remain usable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private _connected = false;

  constructor(private readonly config: ConfigService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.databaseUrl) {
      this.logger.warn(
        'DATABASE_URL is not set — running without a database connection (development mode)',
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
