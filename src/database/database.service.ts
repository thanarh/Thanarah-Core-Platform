import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';

@Injectable()
export class DatabaseService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  isConnected(): boolean {
    return this.connection.readyState === ConnectionStates.connected;
  }

  async disconnect(): Promise<void> {
    await this.connection.close();
  }
}
