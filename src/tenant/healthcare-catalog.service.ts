import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType, TenantCatalogStatus } from '../common/domain-enums';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import {
  createHealthcareCatalogSchema,
  healthcareCatalogIdSchema,
  listHealthcareCatalogQuerySchema,
  updateHealthcareCatalogSchema,
  type CreateHealthcareCatalogInput,
  type HealthcareCatalogKind,
  type ListHealthcareCatalogQuery,
  type UpdateHealthcareCatalogInput,
} from './healthcare-catalog.dto';
import {
  HealthcareCatalogIdInvalidError,
  HealthcareCatalogInputValidationError,
  HealthcareCatalogLifecycleConflictError,
  HealthcareCatalogNameConflictError,
  HealthcareCatalogNotFoundError,
} from './healthcare-catalog.errors';
import {
  HEALTHCARE_CATALOG_PERSISTENCE,
  type HealthcareCatalogMutationResult,
  type HealthcareCatalogPersistencePort,
  type HealthcareCatalogRecord,
} from '../persistence/platform-persistence.ports';

export type HealthcareCatalogAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

@Injectable()
export class HealthcareCatalogService {
  constructor(
    @Inject(HEALTHCARE_CATALOG_PERSISTENCE)
    private readonly catalogs: HealthcareCatalogPersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    input: CreateHealthcareCatalogInput,
    actor: AuthenticatedPlatformUser,
    requestContext: HealthcareCatalogAuditContext = {},
  ): Promise<HealthcareCatalogRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const parsed = createHealthcareCatalogSchema.safeParse(input);
    if (!parsed.success) throw new HealthcareCatalogInputValidationError(kind);

    const result = await this.catalogs.create(kind, tenantId, parsed.data);
    const record = this.changedRecord(kind, result);
    await this.audit.recordAudit({
      eventType:
        kind === 'department'
          ? PlatformAuditEventType.DEPARTMENT_CREATED
          : PlatformAuditEventType.SPECIALTY_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: kind === 'department' ? 'DEPARTMENT' : 'SPECIALTY',
        targetId: record.id,
        action: 'created',
        status: record.status,
      },
    });
    return record;
  }

  async list(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    query: ListHealthcareCatalogQuery,
  ): Promise<{ items: HealthcareCatalogRecord[]; limit: number; offset: number }> {
    const tenantId = this.tenantId(context);
    const parsed = listHealthcareCatalogQuerySchema.safeParse(query);
    if (!parsed.success) throw new HealthcareCatalogInputValidationError(kind);
    const { limit, offset } = parsed.data;
    const items = await this.catalogs.list(kind, tenantId, parsed.data);
    return { items, limit, offset };
  }

  async findById(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    id: string,
  ): Promise<HealthcareCatalogRecord> {
    const tenantId = this.tenantId(context);
    const catalogId = this.catalogId(kind, id);
    const record = await this.catalogs.findById(kind, tenantId, catalogId);
    if (!record) throw new HealthcareCatalogNotFoundError(kind);
    return record;
  }

  async update(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    id: string,
    input: UpdateHealthcareCatalogInput,
    actor: AuthenticatedPlatformUser,
    requestContext: HealthcareCatalogAuditContext = {},
  ): Promise<HealthcareCatalogRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const catalogId = this.catalogId(kind, id);
    const parsed = updateHealthcareCatalogSchema.safeParse(input);
    if (!parsed.success) throw new HealthcareCatalogInputValidationError(kind);

    const result = await this.catalogs.update(kind, tenantId, catalogId, parsed.data);
    const record = this.changedRecord(kind, result);
    await this.audit.recordAudit({
      eventType:
        kind === 'department'
          ? PlatformAuditEventType.DEPARTMENT_UPDATED
          : PlatformAuditEventType.SPECIALTY_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: kind === 'department' ? 'DEPARTMENT' : 'SPECIALTY',
        targetId: record.id,
        action: 'updated',
        changedFields: [
          ...(parsed.data.name !== undefined ? ['name'] : []),
          ...(parsed.data.description !== undefined ? ['description'] : []),
        ].join(','),
      },
    });
    return record;
  }

  activate(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: HealthcareCatalogAuditContext = {},
  ): Promise<HealthcareCatalogRecord> {
    return this.transition(kind, context, id, TenantCatalogStatus.ACTIVE, actor, requestContext);
  }

  suspend(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: HealthcareCatalogAuditContext = {},
  ): Promise<HealthcareCatalogRecord> {
    return this.transition(kind, context, id, TenantCatalogStatus.SUSPENDED, actor, requestContext);
  }

  deactivate(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: HealthcareCatalogAuditContext = {},
  ): Promise<HealthcareCatalogRecord> {
    return this.transition(
      kind,
      context,
      id,
      TenantCatalogStatus.DEACTIVATED,
      actor,
      requestContext,
    );
  }

  private async transition(
    kind: HealthcareCatalogKind,
    context: TrustedTenantContext,
    id: string,
    nextStatus: TenantCatalogStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: HealthcareCatalogAuditContext,
  ): Promise<HealthcareCatalogRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const catalogId = this.catalogId(kind, id);
    const current = await this.catalogs.findById(kind, tenantId, catalogId);
    if (!current) throw new HealthcareCatalogNotFoundError(kind);
    if (current.status === nextStatus) return current;
    if (!this.canTransition(current.status, nextStatus)) {
      throw new HealthcareCatalogLifecycleConflictError(kind);
    }

    const changedAt = new Date();
    const result = await this.catalogs.changeStatusIfCurrent(
      kind,
      tenantId,
      catalogId,
      current.status,
      nextStatus,
      changedAt,
    );
    if (result.kind === 'tenant-inactive') throw new TenantContextInvalidError();
    if (result.kind === 'not-found') throw new HealthcareCatalogNotFoundError(kind);
    if (result.kind === 'name-conflict') throw new HealthcareCatalogNameConflictError(kind);
    if (result.kind === 'not-changed') {
      const latest = await this.catalogs.findById(kind, tenantId, catalogId);
      if (!latest) throw new HealthcareCatalogNotFoundError(kind);
      if (latest.status === nextStatus) return latest;
      throw new HealthcareCatalogLifecycleConflictError(kind);
    }
    const record = result.record;
    await this.audit.recordAudit({
      eventType: this.statusAuditEvent(kind, nextStatus),
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: kind === 'department' ? 'DEPARTMENT' : 'SPECIALTY',
        targetId: record.id,
        action:
          nextStatus === TenantCatalogStatus.ACTIVE
            ? 'activated'
            : nextStatus === TenantCatalogStatus.SUSPENDED
              ? 'suspended'
              : 'deactivated',
        fromStatus: current.status,
        toStatus: record.status,
      },
    });
    return record;
  }

  private changedRecord(
    kind: HealthcareCatalogKind,
    result: HealthcareCatalogMutationResult,
  ): HealthcareCatalogRecord {
    if (result.kind === 'changed') return result.record;
    if (result.kind === 'tenant-inactive') throw new TenantContextInvalidError();
    if (result.kind === 'not-found') throw new HealthcareCatalogNotFoundError(kind);
    if (result.kind === 'name-conflict') throw new HealthcareCatalogNameConflictError(kind);
    throw new HealthcareCatalogLifecycleConflictError(kind);
  }

  private tenantId(context: TrustedTenantContext): string {
    if (!context) throw new TenantContextRequiredError();
    if (
      !tenantIdSchema.safeParse(context.tenantId).success ||
      !z.string().uuid().safeParse(context.membershipId).success ||
      !z.string().uuid().safeParse(context.platformUserId).success
    ) {
      throw new TenantContextInvalidError();
    }
    return context.tenantId.toLowerCase();
  }

  private catalogId(kind: HealthcareCatalogKind, id: string): string {
    const parsed = healthcareCatalogIdSchema.safeParse(id);
    if (!parsed.success) throw new HealthcareCatalogIdInvalidError(kind);
    return parsed.data;
  }

  private assertActor(context: TrustedTenantContext, actor: AuthenticatedPlatformUser): void {
    if (
      !actor ||
      typeof actor.userId !== 'string' ||
      actor.userId.toLowerCase() !== context.platformUserId.toLowerCase()
    ) {
      throw new TenantContextInvalidError();
    }
  }

  private canTransition(current: TenantCatalogStatus, next: TenantCatalogStatus): boolean {
    if (current === TenantCatalogStatus.ACTIVE) {
      return next === TenantCatalogStatus.SUSPENDED || next === TenantCatalogStatus.DEACTIVATED;
    }
    if (current === TenantCatalogStatus.SUSPENDED) {
      return next === TenantCatalogStatus.ACTIVE || next === TenantCatalogStatus.DEACTIVATED;
    }
    return false;
  }

  private statusAuditEvent(
    kind: HealthcareCatalogKind,
    status: TenantCatalogStatus,
  ): PlatformAuditEventType {
    if (kind === 'department') {
      if (status === TenantCatalogStatus.SUSPENDED) {
        return PlatformAuditEventType.DEPARTMENT_SUSPENDED;
      }
      if (status === TenantCatalogStatus.ACTIVE) {
        return PlatformAuditEventType.DEPARTMENT_ACTIVATED;
      }
      return PlatformAuditEventType.DEPARTMENT_DEACTIVATED;
    }
    if (status === TenantCatalogStatus.SUSPENDED) {
      return PlatformAuditEventType.SPECIALTY_SUSPENDED;
    }
    if (status === TenantCatalogStatus.ACTIVE) {
      return PlatformAuditEventType.SPECIALTY_ACTIVATED;
    }
    return PlatformAuditEventType.SPECIALTY_DEACTIVATED;
  }
}
