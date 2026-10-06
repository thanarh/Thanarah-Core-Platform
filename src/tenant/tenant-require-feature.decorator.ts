import { SetMetadata } from '@nestjs/common';

export const TENANT_REQUIRED_FEATURE = 'tenant:required-feature';

const featureKeyPattern = /^[A-Z][A-Z0-9_]{0,63}$/;

export function isTenantFeatureKey(value: unknown): value is string {
  return typeof value === 'string' && featureKeyPattern.test(value);
}

export const RequireTenantFeature = (featureKey: string): MethodDecorator & ClassDecorator => {
  if (!isTenantFeatureKey(featureKey)) {
    throw new TypeError('Tenant feature metadata must use a valid server-defined feature key');
  }
  return SetMetadata(TENANT_REQUIRED_FEATURE, featureKey);
};
