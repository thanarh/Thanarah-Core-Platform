import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class PasswordPolicyService {
  validate(password: string): void {
    const errors: string[] = [];
    if (password.length < 12) errors.push('at least 12 characters');
    if (password.length > 128) errors.push('at most 128 characters');
    if (!/[a-z]/.test(password)) errors.push('a lowercase letter');
    if (!/[A-Z]/.test(password)) errors.push('an uppercase letter');
    if (!/\d/.test(password)) errors.push('a number');
    if (!/[^A-Za-z0-9]/.test(password)) errors.push('a special character');
    if (errors.length > 0) {
      throw new BadRequestException(`Password must contain ${errors.join(', ')}`);
    }
  }
}
