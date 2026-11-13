import { Inject, Injectable } from '@nestjs/common';
import { FeatureStatus, PlatformAuditEventType } from '../common/domain-enums';
import { isLegacyUniqueConstraintError } from '../common/legacy-unique-constraint';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import {
  changeFeatureStatusSchema,
  createFeatureSchema,
  featureIdSchema,
  listFeaturesQuerySchema,
  updateFeatureSchema,
  type CreateFeatureInput,
  type ListFeaturesQuery,
  type UpdateFeatureInput,
} from './catalog.dto';
import type { CatalogAuditContext } from './catalog-audit.context';
import {
  CatalogIdInvalidError,
  FeatureInputInvalidError,
  FeatureKeyConflictError,
  FeatureLifecycleConflictError,
  FeatureNotFoundError,
} from './catalog.errors';
import type {
  FeaturePersistencePort,
  FeatureRecord,
} from '../persistence/platform-persistence.ports';
import { FEATURE_PERSISTENCE } from '../persistence/platform-persistence.ports';

@Injectable()
export class FeatureService {
  constructor(
    @Inject(FEATURE_PERSISTENCE) private readonly features: FeaturePersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    input: CreateFeatureInput,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<FeatureRecord> {
    const parsed = createFeatureSchema.safeParse(input);
    if (!parsed.success) throw new FeatureInputInvalidError();
    if (await this.features.findByKey(parsed.data.key)) throw new FeatureKeyConflictError();

    let feature: FeatureRecord;
    try {
      feature = await this.features.create(parsed.data);
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new FeatureKeyConflictError();
      throw error;
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.FEATURE_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: { featureId: feature.id, featureKey: feature.key, status: feature.status },
    });
    return feature;
  }

  async list(
    query: ListFeaturesQuery,
  ): Promise<{ items: FeatureRecord[]; limit: number; offset: number }> {
    const parsed = listFeaturesQuerySchema.safeParse(query);
    if (!parsed.success) throw new FeatureInputInvalidError();
    const { status, limit, offset } = parsed.data;
    const items = await this.features.list({ status, limit, offset });
    return { items, limit, offset };
  }

  async findById(id: string): Promise<FeatureRecord> {
    this.assertFeatureId(id);
    const feature = await this.features.findById(id);
    if (!feature) throw new FeatureNotFoundError();
    return feature;
  }

  async update(
    id: string,
    input: UpdateFeatureInput,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<FeatureRecord> {
    this.assertFeatureId(id);
    const parsed = updateFeatureSchema.safeParse(input);
    if (!parsed.success) throw new FeatureInputInvalidError();
    const current = await this.findById(id);

    const changes: { name?: string; description?: string | null } = {};
    if (parsed.data.name !== undefined && parsed.data.name !== current.name) {
      changes.name = parsed.data.name;
    }
    if (parsed.data.description !== undefined && parsed.data.description !== current.description) {
      changes.description = parsed.data.description;
    }
    if (Object.keys(changes).length === 0) return current;

    const updated = await this.features.updateIfCurrentStatus(id, current.status, changes);
    if (!updated) {
      const latest = await this.features.findById(id);
      if (!latest) throw new FeatureNotFoundError();
      if (
        latest.status === current.status &&
        Object.entries(changes).every(
          ([key, value]) => latest[key as 'name' | 'description'] === value,
        )
      ) {
        return latest;
      }
      throw new FeatureLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.FEATURE_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: {
        featureId: updated.id,
        featureKey: updated.key,
        changedFields: Object.keys(changes).join(','),
      },
    });
    return updated;
  }

  async changeStatus(
    id: string,
    status: FeatureStatus,
    actor: AuthenticatedPlatformUser,
    context: CatalogAuditContext = {},
  ): Promise<FeatureRecord> {
    this.assertFeatureId(id);
    if (!changeFeatureStatusSchema.safeParse({ status }).success) {
      throw new FeatureInputInvalidError();
    }
    const current = await this.findById(id);
    if (current.status === status) return current;

    const updated = await this.features.changeStatusIfCurrent(
      id,
      current.status,
      status,
      new Date(),
    );
    if (!updated) {
      const latest = await this.features.findById(id);
      if (!latest) throw new FeatureNotFoundError();
      if (latest.status === status) return latest;
      throw new FeatureLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType:
        status === FeatureStatus.ACTIVE
          ? PlatformAuditEventType.FEATURE_ACTIVATED
          : PlatformAuditEventType.FEATURE_DEACTIVATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      ...context,
      metadata: {
        featureId: updated.id,
        featureKey: updated.key,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });
    return updated;
  }

  private assertFeatureId(id: string): void {
    if (!featureIdSchema.safeParse(id).success) throw new CatalogIdInvalidError('Feature');
  }

  private isUniqueConflict(error: unknown): boolean {
    return isLegacyUniqueConstraintError(error);
  }
}
