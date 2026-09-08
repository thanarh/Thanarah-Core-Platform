import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

export const ARGON2_OPTIONS: Readonly<argon2.Options & { raw?: false }> = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

@Injectable()
export class PasswordHasherService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password, ARGON2_OPTIONS);
  }
}
