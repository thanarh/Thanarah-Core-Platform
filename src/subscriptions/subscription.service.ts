import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType, SubscriptionStatus } from '../common/domain-enums';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import {
  currentSubscriptionQuerySchema,
  createSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionIdSchema,
  type CreateSubscriptionInput,
  type ListSubscriptionsQuery,
} from './subscription.dto';
import {
  SubscriptionCurrentConflictError,
  SubscriptionIdInvalidError,
  SubscriptionInputInvalidError,
  SubscriptionInvariantViolationError,
  SubscriptionLifecycleConflictError,
  SubscriptionNotFoundError,
  SubscriptionPlanNotFoundError,
  SubscriptionPlanUnavailableError,
  SubscriptionTenantNotFoundError,
  SubscriptionTenantUnavailableError,
} from './subscription.errors';
import type { SubscriptionAuditContext } from './subscription-audit.context';
import {
  effectiveSubscriptionStatus,
  initialSubscriptionStatus,
  type EffectiveSubscriptionStatus,
  type SubscriptionLifecycleAction,
} from './subscription.rules';
import {
  SUBSCRIPTION_PERSISTENCE,
  type SubscriptionPersistencePort,
  type SubscriptionRecord,
} from '../persistence/platform-persistence.ports';

export type SubscriptionView = SubscriptionRecord & {
  effectiveStatus: EffectiveSubscriptionStatus;
};

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(SUBSCRIPTION_PERSISTENCE) private readonly subscriptions: SubscriptionPersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    input: CreateSubscriptionInput,
    actor: AuthenticatedPlatformUser,
    context: SubscriptionAuditContext = {},
  ): Promise<SubscriptionView> {
    const parsed = createSubscriptionSchema.safeParse(input);
    if (!parsed.success) throw new SubscriptionInputInvalidError();

    const now = new Date();
    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
    const status = initialSubscriptionStatus(endsAt, now);
    const result = await this.subscriptions.createForActiveTenantAndPlan({
      tenantId: parsed.data.tenantId,
      planId: parsed.data.planId,
      status,
      startsAt,
      endsAt,
    });

    if (result.kind === 'tenant-not-found') throw new SubscriptionTenantNotFoundError();
    if (result.kind === 'tenant-unavailable') throw new SubscriptionTenantUnavailableError();
    if (result.kind === 'plan-not-found') throw new SubscriptionPlanNotFoundError();
    if (result.kind === 'plan-unavailable') throw new SubscriptionPlanUnavailableError();
    if (result.kind === 'period-conflict') throw new SubscriptionCurrentConflictError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.SUBSCRIPTION_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: result.subscription.tenantId,
      ...context,
      metadata: {
        subscriptionId: result.subscription.id,
        tenantId: result.subscription.tenantId,
        planId: result.subscription.planId,
        status: result.subscription.status,
        startsAt: result.subscription.startsAt.toISOString(),
        endsAt: result.subscription.endsAt?.toISOString() ?? null,
      },
    });
    return this.toView(result.subscription, new Date());
  }

  async list(query: ListSubscriptionsQuery): Promise<{
    items: SubscriptionView[];
    limit: number;
    offset: number;
  }> {
    const parsed = listSubscriptionsQuerySchema.safeParse(query);
    if (!parsed.success) throw new SubscriptionInputInvalidError();
    const { tenantId, status, limit, offset } = parsed.data;
    const records = await this.subscriptions.list({ tenantId, status, limit, offset });
    const now = new Date();
    return { items: records.map((record) => this.toView(record, now)), limit, offset };
  }

  async findById(id: string): Promise<SubscriptionView> {
    this.assertSubscriptionId(id);
    const subscription = await this.subscriptions.findById(id);
    if (!subscription) throw new SubscriptionNotFoundError();
    return this.toView(subscription, new Date());
  }

  async findCurrentForTenant(tenantId: string): Promise<SubscriptionView | null> {
    const parsed = currentSubscriptionQuerySchema.safeParse({ tenantId });
    if (!parsed.success) throw new SubscriptionInputInvalidError();
    const now = new Date();
    const matching = await this.subscriptions.findCurrentForTenant(parsed.data.tenantId, now);
    if (matching.length > 1) throw new SubscriptionInvariantViolationError();
    const current = matching[0];
    return current ? this.toView(current, now) : null;
  }

  async activate(
    id: string,
    actor: AuthenticatedPlatformUser,
    context: SubscriptionAuditContext = {},
  ): Promise<SubscriptionView> {
    return this.transition(id, 'activate', actor, context);
  }

  async suspend(
    id: string,
    actor: AuthenticatedPlatformUser,
    context: SubscriptionAuditContext = {},
  ): Promise<SubscriptionView> {
    return this.transition(id, 'suspend', actor, context);
  }

  async cancel(
    id: string,
    actor: AuthenticatedPlatformUser,
    context: SubscriptionAuditContext = {},
  ): Promise<SubscriptionView> {
    return this.transition(id, 'cancel', actor, context);
  }

  async expire(
    id: string,
    actor: AuthenticatedPlatformUser,
    context: SubscriptionAuditContext = {},
  ): Promise<SubscriptionView> {
    return this.transition(id, 'expire', actor, context);
  }

  private async transition(
    id: string,
    action: SubscriptionLifecycleAction,
    actor: AuthenticatedPlatformUser,
    context: SubscriptionAuditContext,
  ): Promise<SubscriptionView> {
    this.assertSubscriptionId(id);
    const result = await this.subscriptions.transition(id, action, new Date());
    if (result.kind === 'not-found') throw new SubscriptionNotFoundError();
    if (result.kind === 'tenant-unavailable') throw new SubscriptionTenantUnavailableError();
    if (result.kind === 'period-conflict') throw new SubscriptionCurrentConflictError();
    if (result.kind === 'transition-invalid') throw new SubscriptionLifecycleConflictError();

    const eventType = this.transitionAuditEvent(result.subscription.status);
    await this.audit.recordAudit({
      eventType,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: result.subscription.tenantId,
      ...context,
      metadata: {
        subscriptionId: result.subscription.id,
        tenantId: result.subscription.tenantId,
        planId: result.subscription.planId,
        previousStatus: result.previousStatus,
        newStatus: result.subscription.status,
      },
    });
    return this.toView(result.subscription, new Date());
  }

  private assertSubscriptionId(id: string): void {
    if (!subscriptionIdSchema.safeParse(id).success) throw new SubscriptionIdInvalidError();
  }

  private toView(subscription: SubscriptionRecord, now: Date): SubscriptionView {
    return {
      ...subscription,
      effectiveStatus: effectiveSubscriptionStatus(subscription, now),
    };
  }

  private transitionAuditEvent(status: SubscriptionStatus): PlatformAuditEventType {
    if (status === SubscriptionStatus.ACTIVE) {
      return PlatformAuditEventType.SUBSCRIPTION_ACTIVATED;
    }
    if (status === SubscriptionStatus.SUSPENDED) {
      return PlatformAuditEventType.SUBSCRIPTION_SUSPENDED;
    }
    if (status === SubscriptionStatus.CANCELLED) {
      return PlatformAuditEventType.SUBSCRIPTION_CANCELLED;
    }
    return PlatformAuditEventType.SUBSCRIPTION_EXPIRED;
  }
}
