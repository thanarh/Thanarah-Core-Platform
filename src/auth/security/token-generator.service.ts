import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';

@Injectable()
export class TokenGeneratorService {
  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  generateTokenFamilyId(): string {
    return randomUUID();
  }
}
