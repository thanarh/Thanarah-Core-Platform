import { SubscriptionStatus, TenantStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  decideSubscriptionTransition,
  effectiveSubscriptionStatus,
  initialSubscriptionStatus,
  isEffectiveSubscription,
} from '../src/subscriptions/subscription.rules';

const now = new Date('2026-10-06T12:00:00.000Z');
const prior = new Date('2026-10-06T11:00:00.000Z');
const future = new Date('2026-10-06T13:00:00.000Z');
const later = new Date('2026-10-06T14:00:00.000Z');

function subscription(
  status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
  overrides: { startsAt?: Date; endsAt?: Date | null } = {},
): { status: SubscriptionStatus; startsAt: Date; endsAt: Date | null } {
  return {
    status,
    startsAt: overrides.startsAt ?? prior,
    endsAt: overrides.endsAt === undefined ? null : overrides.endsAt,
  };
}

describe('Subscription lifecycle and effective-state rules', () => {
  it('treats an ACTIVE period containing the UTC instant as current', () => {
    const active = subscription(SubscriptionStatus.ACTIVE, { startsAt: prior, endsAt: future });

    expect(isEffectiveSubscription(active, now)).toBe(true);
    expect(effectiveSubscriptionStatus(active, now)).toBe('ACTIVE');
  });

  it('uses an exclusive end boundary and never treats a future start as current', () => {
    expect(
      isEffectiveSubscription(
        subscription(SubscriptionStatus.ACTIVE, { startsAt: prior, endsAt: now }),
        now,
      ),
    ).toBe(false);
    expect(
      isEffectiveSubscription(
        subscription(SubscriptionStatus.ACTIVE, { startsAt: future, endsAt: later }),
        now,
      ),
    ).toBe(false);
    expect(
      effectiveSubscriptionStatus(
        subscription(SubscriptionStatus.ACTIVE, { startsAt: future, endsAt: later }),
        now,
      ),
    ).toBe('SCHEDULED');
  });

  it('does not return suspended, cancelled, or persisted expired records as current', () => {
    for (const status of [
      SubscriptionStatus.SUSPENDED,
      SubscriptionStatus.CANCELLED,
      SubscriptionStatus.EXPIRED,
    ]) {
      expect(isEffectiveSubscription(subscription(status), now)).toBe(false);
    }
  });

  it('reports a past-ended ACTIVE or SUSPENDED record as effectively expired without mutating it', () => {
    const active = subscription(SubscriptionStatus.ACTIVE, { startsAt: prior, endsAt: prior });
    const suspended = subscription(SubscriptionStatus.SUSPENDED, {
      startsAt: prior,
      endsAt: prior,
    });

    expect(effectiveSubscriptionStatus(active, now)).toBe('EXPIRED');
    expect(effectiveSubscriptionStatus(suspended, now)).toBe('EXPIRED');
    expect(active.status).toBe(SubscriptionStatus.ACTIVE);
    expect(suspended.status).toBe(SubscriptionStatus.SUSPENDED);
    expect(isEffectiveSubscription(active, now)).toBe(false);
  });

  it('preserves explicit CANCELLED and EXPIRED states in the effective read state', () => {
    expect(effectiveSubscriptionStatus(subscription(SubscriptionStatus.CANCELLED), now)).toBe(
      'CANCELLED',
    );
    expect(effectiveSubscriptionStatus(subscription(SubscriptionStatus.EXPIRED), now)).toBe(
      'EXPIRED',
    );
  });

  it('creates an ended period as EXPIRED and all other periods as ACTIVE', () => {
    expect(initialSubscriptionStatus(prior, now)).toBe(SubscriptionStatus.EXPIRED);
    expect(initialSubscriptionStatus(now, now)).toBe(SubscriptionStatus.EXPIRED);
    expect(initialSubscriptionStatus(future, now)).toBe(SubscriptionStatus.ACTIVE);
    expect(initialSubscriptionStatus(null, now)).toBe(SubscriptionStatus.ACTIVE);
  });

  it('allows ACTIVE → SUSPENDED, SUSPENDED → ACTIVE, and explicit cancellation', () => {
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.ACTIVE, { endsAt: future }),
        'suspend',
        TenantStatus.ACTIVE,
        now,
      ),
    ).toEqual({
      kind: 'transition',
      status: SubscriptionStatus.SUSPENDED,
      cancelledAt: null,
    });
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.SUSPENDED, { endsAt: future }),
        'activate',
        TenantStatus.ACTIVE,
        now,
      ),
    ).toEqual({
      kind: 'transition',
      status: SubscriptionStatus.ACTIVE,
      cancelledAt: null,
    });

    const cancellation = decideSubscriptionTransition(
      subscription(SubscriptionStatus.ACTIVE, { endsAt: future }),
      'cancel',
      TenantStatus.ACTIVE,
      now,
    );
    expect(cancellation).toEqual({
      kind: 'transition',
      status: SubscriptionStatus.CANCELLED,
      cancelledAt: now,
    });
  });

  it('does not allow activating a Subscription for an unavailable Tenant', () => {
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.SUSPENDED, { endsAt: future }),
        'activate',
        TenantStatus.DEACTIVATED,
        now,
      ),
    ).toEqual({ kind: 'tenant-unavailable' });
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.SUSPENDED, { endsAt: future }),
        'activate',
        TenantStatus.SUSPENDED,
        now,
      ),
    ).toEqual({ kind: 'tenant-unavailable' });
  });

  it('allows explicit expiration only after an end date for nonterminal records', () => {
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.ACTIVE, { endsAt: prior }),
        'expire',
        TenantStatus.ACTIVE,
        now,
      ),
    ).toEqual({
      kind: 'transition',
      status: SubscriptionStatus.EXPIRED,
      cancelledAt: null,
    });
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.SUSPENDED, { endsAt: prior }),
        'expire',
        TenantStatus.ACTIVE,
        now,
      ).kind,
    ).toBe('transition');
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.ACTIVE, { endsAt: future }),
        'expire',
        TenantStatus.ACTIVE,
        now,
      ),
    ).toEqual({ kind: 'invalid-transition' });
  });

  it('rejects invalid, repeated, terminal, future-cancel, and ended-period transitions', () => {
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.ACTIVE, { endsAt: future }),
        'activate',
        TenantStatus.ACTIVE,
        now,
      ).kind,
    ).toBe('invalid-transition');
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.CANCELLED),
        'activate',
        TenantStatus.ACTIVE,
        now,
      ).kind,
    ).toBe('invalid-transition');
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.ACTIVE, { startsAt: future, endsAt: later }),
        'cancel',
        TenantStatus.ACTIVE,
        now,
      ).kind,
    ).toBe('invalid-transition');
    expect(
      decideSubscriptionTransition(
        subscription(SubscriptionStatus.ACTIVE, { endsAt: prior }),
        'suspend',
        TenantStatus.ACTIVE,
        now,
      ).kind,
    ).toBe('invalid-transition');
  });
});
