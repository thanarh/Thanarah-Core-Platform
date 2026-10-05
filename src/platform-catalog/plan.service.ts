import { Injectable } from '@nestjs/common';
import { FeatureStatus, PlanStatus, PlatformAuditEventType, Prisma } from '@prisma/client';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import {
  changePlanStatusSchema,
  createPlanSchema,
  featureIdSchema,
  listPlansQuerySchema,
  planIdSchema,
  updatePlanFeatureSchema,
  updatePlanSchema,
  type CreatePlanInput,
  type ListPlansQuery,
  type UpdatePlanFeatureInput,
  type UpdatePlanInput,
} from './catalog.dto';
import type { CatalogAuditContext } from './catalog-audit.context';
import {
  CatalogIdInvalidError,
  FeatureNotFoundError,
  PlanFeatureConflictError,
  PlanFeatureNotFoundError,
  PlanInputInvalidError,
  PlanKeyConflictError,
  PlanLifecycleConflictError,
  PlanNotFoundError,
} from './catalog.errors';
import { FeatureRepository, type FeatureRecord } from './feature.repository';
import { PlanRepository, type PlanFeatureRecord, type PlanRecord } from './plan.repository';

@Injectable()
export class PlanService {
  constructor(
    private readonly plans: PlanRepository,
    private readonly features: FeatureRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    input: CreatePlanInput,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<PlanRecord> {
    const parsed = createPlanSchema.safeParse(input);
    if (!parsed.success) throw new PlanInputInvalidError();
    if (await this.plans.findByKey(parsed.data.key)) throw new PlanKeyConflictError();

    let plan: PlanRecord;
    try {
      plan = await this.plans.create(parsed.data);
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new PlanKeyConflictError();
      throw error;
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PLAN_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: { planId: plan.id, planKey: plan.key, status: plan.status },
    });
    return plan;
  }

  async list(
    query: ListPlansQuery,
  ): Promise<{ items: PlanRecord[]; limit: number; offset: number }> {
    const parsed = listPlansQuerySchema.safeParse(query);
    if (!parsed.success) throw new PlanInputInvalidError();
    const { status, limit, offset } = parsed.data;
    const items = await this.plans.list({ status, limit, offset });
    return { items, limit, offset };
  }

  async findById(id: string): Promise<PlanRecord> {
    this.assertPlanId(id);
    const plan = await this.plans.findById(id);
    if (!plan) throw new PlanNotFoundError();
    return plan;
  }

  async update(
    id: string,
    input: UpdatePlanInput,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<PlanRecord> {
    this.assertPlanId(id);
    const parsed = updatePlanSchema.safeParse(input);
    if (!parsed.success) throw new PlanInputInvalidError();
    const current = await this.findById(id);
    if (current.status === PlanStatus.ARCHIVED) throw new PlanLifecycleConflictError();

    const changes: { name?: string; description?: string | null } = {};
    if (parsed.data.name !== undefined && parsed.data.name !== current.name) {
      changes.name = parsed.data.name;
    }
    if (parsed.data.description !== undefined && parsed.data.description !== current.description) {
      changes.description = parsed.data.description;
    }
    if (Object.keys(changes).length === 0) return current;

    const updated = await this.plans.updateIfCurrentStatus(id, current.status, changes);
    if (!updated) {
      const latest = await this.plans.findById(id);
      if (!latest) throw new PlanNotFoundError();
      if (
        latest.status !== PlanStatus.ARCHIVED &&
        Object.entries(changes).every(
          ([key, value]) => latest[key as 'name' | 'description'] === value,
        )
      ) {
        return latest;
      }
      throw new PlanLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PLAN_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: {
        planId: updated.id,
        planKey: updated.key,
        changedFields: Object.keys(changes).join(','),
      },
    });
    return updated;
  }

  async changeStatus(
    id: string,
    status: PlanStatus,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<PlanRecord> {
    this.assertPlanId(id);
    if (!changePlanStatusSchema.safeParse({ status }).success) {
      throw new PlanInputInvalidError();
    }
    const current = await this.findById(id);
    if (current.status === status) return current;
    if (!this.canTransition(current.status, status)) throw new PlanLifecycleConflictError();

    const updated = await this.plans.changeStatusIfCurrent(id, current.status, status, new Date());
    if (!updated) {
      const latest = await this.plans.findById(id);
      if (!latest) throw new PlanNotFoundError();
      if (latest.status === status) return latest;
      throw new PlanLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType: this.statusAuditEvent(status),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: {
        planId: updated.id,
        planKey: updated.key,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });
    return updated;
  }

  async listFeatures(planId: string): Promise<PlanFeatureRecord[]> {
    const plan = await this.findById(planId);
    return this.plans.listFeatures(plan.id);
  }

  async attachFeature(
    planId: string,
    featureId: string,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<PlanFeatureRecord> {
    const plan = await this.findById(planId);
    const feature = await this.findFeatureById(featureId);
    this.assertPlanAllowsFeatureChanges(plan);
    if (feature.status !== FeatureStatus.ACTIVE) {
      throw new PlanFeatureConflictError('Inactive Features cannot be newly attached to a Plan');
    }
    if (await this.plans.findPlanFeature(plan.id, feature.id)) {
      throw new PlanFeatureConflictError();
    }

    let association: PlanFeatureRecord;
    try {
      association = await this.plans.attachFeature(plan.id, feature.id);
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new PlanFeatureConflictError();
      throw error;
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PLAN_FEATURE_ATTACHED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: {
        planId: plan.id,
        planKey: plan.key,
        featureId: feature.id,
        featureKey: feature.key,
        enabled: association.enabled,
      },
    });
    return association;
  }

  async updateFeature(
    planId: string,
    featureId: string,
    input: UpdatePlanFeatureInput,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<PlanFeatureRecord> {
    const plan = await this.findById(planId);
    const parsed = updatePlanFeatureSchema.safeParse(input);
    if (!parsed.success) throw new PlanInputInvalidError();
    const feature = await this.findFeatureById(featureId);
    this.assertPlanAllowsFeatureChanges(plan);

    const current = await this.plans.findPlanFeature(plan.id, feature.id);
    if (!current) throw new PlanFeatureNotFoundError();
    if (parsed.data.enabled && feature.status !== FeatureStatus.ACTIVE) {
      throw new PlanFeatureConflictError('Inactive Features cannot be enabled on a Plan');
    }
    if (current.enabled === parsed.data.enabled) return current;

    const updated = await this.plans.updateFeatureEnabled(plan.id, feature.id, parsed.data.enabled);
    if (!updated) throw new PlanFeatureNotFoundError();

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PLAN_FEATURE_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: {
        planId: plan.id,
        planKey: plan.key,
        featureId: feature.id,
        featureKey: feature.key,
        enabled: updated.enabled,
      },
    });
    return updated;
  }

  async detachFeature(
    planId: string,
    featureId: string,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<{ detached: true }> {
    const plan = await this.findById(planId);
    const feature = await this.findFeatureById(featureId);
    this.assertPlanAllowsFeatureChanges(plan);
    const association = await this.plans.findPlanFeature(plan.id, feature.id);
    if (!association) throw new PlanFeatureNotFoundError();
    if (!(await this.plans.detachFeature(plan.id, feature.id))) {
      throw new PlanFeatureNotFoundError();
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.PLAN_FEATURE_DETACHED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: {
        planId: plan.id,
        planKey: plan.key,
        featureId: feature.id,
        featureKey: feature.key,
        wasEnabled: association.enabled,
      },
    });
    return { detached: true };
  }

  private async findFeatureById(id: string): Promise<FeatureRecord> {
    if (!featureIdSchema.safeParse(id).success) throw new CatalogIdInvalidError('Feature');
    const feature = await this.features.findById(id);
    if (!feature) throw new FeatureNotFoundError();
    return feature;
  }

  private assertPlanId(id: string): void {
    if (!planIdSchema.safeParse(id).success) throw new CatalogIdInvalidError('Plan');
  }

  private assertPlanAllowsFeatureChanges(plan: PlanRecord): void {
    if (plan.status !== PlanStatus.ACTIVE) throw new PlanLifecycleConflictError();
  }

  private canTransition(current: PlanStatus, next: PlanStatus): boolean {
    if (current === PlanStatus.ARCHIVED) return false;
    if (next === PlanStatus.ARCHIVED) return true;
    return (
      (current === PlanStatus.ACTIVE && next === PlanStatus.INACTIVE) ||
      (current === PlanStatus.INACTIVE && next === PlanStatus.ACTIVE)
    );
  }

  private statusAuditEvent(status: PlanStatus): PlatformAuditEventType {
    if (status === PlanStatus.ACTIVE) return PlatformAuditEventType.PLAN_ACTIVATED;
    if (status === PlanStatus.INACTIVE) return PlatformAuditEventType.PLAN_DEACTIVATED;
    return PlatformAuditEventType.PLAN_ARCHIVED;
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
