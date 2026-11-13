import { SubscriptionStatus, TenantStatus } from '../common/domain-enums';

export type EffectiveSubscriptionStatus =
  'ACTIVE' | 'SCHEDULED' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

export type SubscriptionLifecycleAction = 'activate' | 'suspend' | 'cancel' | 'expire';

export interface SubscriptionPeriod {
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
}

export type SubscriptionTransitionDecision =
  | { kind: 'invalid-transition' }
  | { kind: 'tenant-unavailable' }
  | { kind: 'transition'; status: SubscriptionStatus; cancelledAt: Date | null };

export function effectiveSubscriptionStatus(
  subscription: SubscriptionPeriod,
  now: Date,
): EffectiveSubscriptionStatus {
  if (subscription.status === SubscriptionStatus.CANCELLED) return 'CANCELLED';
  if (subscription.status === SubscriptionStatus.EXPIRED) return 'EXPIRED';
  if (subscription.endsAt !== null && subscription.endsAt <= now) return 'EXPIRED';
  if (subscription.status === SubscriptionStatus.SUSPENDED) return 'SUSPENDED';
  if (subscription.startsAt > now) return 'SCHEDULED';
  return 'ACTIVE';
}

export function isEffectiveSubscription(subscription: SubscriptionPeriod, asOf: Date): boolean {
  return (
    subscription.status === SubscriptionStatus.ACTIVE &&
    subscription.startsAt <= asOf &&
    (subscription.endsAt === null || subscription.endsAt > asOf)
  );
}

export function initialSubscriptionStatus(endsAt: Date | null, now: Date): SubscriptionStatus {
  return endsAt !== null && endsAt <= now ? SubscriptionStatus.EXPIRED : SubscriptionStatus.ACTIVE;
}

export function decideSubscriptionTransition(
  subscription: SubscriptionPeriod,
  action: SubscriptionLifecycleAction,
  tenantStatus: TenantStatus,
  now: Date,
): SubscriptionTransitionDecision {
  if (action === 'activate') {
    if (
      subscription.status !== SubscriptionStatus.SUSPENDED ||
      (subscription.endsAt !== null && subscription.endsAt <= now)
    ) {
      return { kind: 'invalid-transition' };
    }
    if (tenantStatus !== TenantStatus.ACTIVE) return { kind: 'tenant-unavailable' };
    return { kind: 'transition', status: SubscriptionStatus.ACTIVE, cancelledAt: null };
  }

  if (action === 'suspend') {
    if (
      subscription.status !== SubscriptionStatus.ACTIVE ||
      (subscription.endsAt !== null && subscription.endsAt <= now)
    ) {
      return { kind: 'invalid-transition' };
    }
    return { kind: 'transition', status: SubscriptionStatus.SUSPENDED, cancelledAt: null };
  }

  if (action === 'cancel') {
    if (
      (subscription.status !== SubscriptionStatus.ACTIVE &&
        subscription.status !== SubscriptionStatus.SUSPENDED) ||
      subscription.startsAt > now ||
      (subscription.endsAt !== null && subscription.endsAt <= now)
    ) {
      return { kind: 'invalid-transition' };
    }
    return {
      kind: 'transition',
      status: SubscriptionStatus.CANCELLED,
      cancelledAt: now,
    };
  }

  if (
    (subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.SUSPENDED) ||
    subscription.endsAt === null ||
    subscription.endsAt > now
  ) {
    return { kind: 'invalid-transition' };
  }
  return { kind: 'transition', status: SubscriptionStatus.EXPIRED, cancelledAt: null };
}
