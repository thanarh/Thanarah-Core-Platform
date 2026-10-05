import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import { APP_CONSTANTS } from '../src/common/constants/app.constants';
import { AppController } from '../src/app.controller';

describe('platform API route conventions', () => {
  it('mounts application API routes under /api/v1', () => {
    expect(APP_CONSTANTS.apiPrefix).toBe('api');
    expect(APP_CONSTANTS.apiVersion).toBe('v1');
    expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('v1/auth');
  });

  it('keeps health, readiness, and documentation paths unversioned', () => {
    expect(APP_CONSTANTS.apiPrefixExclusions).toEqual(['health', 'ready']);
    expect(Reflect.getMetadata(PATH_METADATA, AppController.prototype.health)).toBe('health');
    expect(Reflect.getMetadata(PATH_METADATA, AppController.prototype.ready)).toBe('ready');
    expect(APP_CONSTANTS.swagger.path).toBe('docs');
  });
});
