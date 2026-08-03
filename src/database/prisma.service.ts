import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService wraps PrismaClient for NestJS lifecycle management.
 *
 * Connection behaviour:
 *  - Production (cPanel): DATABASE_URL is set in the Node.js app environment;
 *    the client connects normally on module init.
 *  - Replit development: DATABASE_URL is absent or empty; $connect() is
 *    attempted but the resulting error is caught and logged. The service stays
 *    operational with isConnected() returning false. No crash, no exit.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private _connected = false;

  async onModuleInit(): Promise<void> {
    const url = process.env['DATABASE_URL'];

    if (!url) {
      this.logger.warn(
        'DATABASE_URL is not set — running without a database connection (development mode)',
      );
      return;
    }

    try {
      await this.$connect();
      this._connected = true;
      this.logger.log('Database connection established');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Database connection unavailable: ${message}`);
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
}
