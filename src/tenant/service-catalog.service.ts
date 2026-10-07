import { Injectable } from '@nestjs/common';
import { PlatformAuditEventType, TenantCatalogStatus } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';
import { TenantContextInvalidError, TenantContextRequiredError } from './tenant-context.contract';
import type { TrustedTenantContext } from './tenant-context.contract';
import { tenantIdSchema } from './tenant.dto';
import {
  createServiceSchema,
  listServicesQuerySchema,
  serviceIdSchema,
  updateServiceSchema,
  type CreateServiceInput,
  type ListServicesQuery,
  type UpdateServiceInput,
} from './service-catalog.dto';
import {
  ServiceCodeConflictError,
  ServiceConflictError,
  ServiceIdInvalidError,
  ServiceInputValidationError,
  ServiceLifecycleConflictError,
  ServiceNameConflictError,
  ServiceNotFoundError,
} from './service-catalog.errors';
import {
  ServiceCatalogRepository,
  type ServiceCatalogMutationResult,
  type ServiceCatalogRecord,
} from './service-catalog.repository';

export type ServiceCatalogAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

@Injectable()
export class ServiceCatalogService {
  constructor(
    private readonly services: ServiceCatalogRepository,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    context: TrustedTenantContext,
    input: CreateServiceInput,
    actor: AuthenticatedPlatformUser,
    requestContext: ServiceCatalogAuditContext = {},
  ): Promise<ServiceCatalogRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const parsed = createServiceSchema.safeParse(input);
    if (!parsed.success) throw new ServiceInputValidationError();

    const record = this.changedRecord(await this.services.create(tenantId, parsed.data));
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.SERVICE_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: 'SERVICE',
        targetId: record.id,
        action: 'created',
        status: record.status,
      },
    });
    return record;
  }

  async list(
    context: TrustedTenantContext,
    query: ListServicesQuery,
  ): Promise<{ items: ServiceCatalogRecord[]; limit: number; offset: number }> {
    const tenantId = this.tenantId(context);
    const parsed = listServicesQuerySchema.safeParse(query);
    if (!parsed.success) throw new ServiceInputValidationError();
    const { limit, offset } = parsed.data;
    const items = await this.services.list(tenantId, parsed.data);
    return { items, limit, offset };
  }

  async findById(context: TrustedTenantContext, id: string): Promise<ServiceCatalogRecord> {
    const tenantId = this.tenantId(context);
    const serviceId = this.serviceId(id);
    const record = await this.services.findById(tenantId, serviceId);
    if (!record) throw new ServiceNotFoundError();
    return record;
  }

  async update(
    context: TrustedTenantContext,
    id: string,
    input: UpdateServiceInput,
    actor: AuthenticatedPlatformUser,
    requestContext: ServiceCatalogAuditContext = {},
  ): Promise<ServiceCatalogRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const serviceId = this.serviceId(id);
    const parsed = updateServiceSchema.safeParse(input);
    if (!parsed.success) throw new ServiceInputValidationError();

    const record = this.changedRecord(await this.services.update(tenantId, serviceId, parsed.data));
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.SERVICE_UPDATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: 'SERVICE',
        targetId: record.id,
        action: 'updated',
        changedFields: [
          ...(parsed.data.name !== undefined ? ['name'] : []),
          ...(parsed.data.code !== undefined ? ['code'] : []),
          ...(parsed.data.description !== undefined ? ['description'] : []),
        ].join(','),
      },
    });
    return record;
  }

  activate(
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: ServiceCatalogAuditContext = {},
  ): Promise<ServiceCatalogRecord> {
    return this.transition(context, id, TenantCatalogStatus.ACTIVE, actor, requestContext);
  }

  suspend(
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: ServiceCatalogAuditContext = {},
  ): Promise<ServiceCatalogRecord> {
    return this.transition(context, id, TenantCatalogStatus.SUSPENDED, actor, requestContext);
  }

  deactivate(
    context: TrustedTenantContext,
    id: string,
    actor: AuthenticatedPlatformUser,
    requestContext: ServiceCatalogAuditContext = {},
  ): Promise<ServiceCatalogRecord> {
    return this.transition(context, id, TenantCatalogStatus.DEACTIVATED, actor, requestContext);
  }

  private async transition(
    context: TrustedTenantContext,
    id: string,
    nextStatus: TenantCatalogStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: ServiceCatalogAuditContext,
  ): Promise<ServiceCatalogRecord> {
    const tenantId = this.tenantId(context);
    this.assertActor(context, actor);
    const serviceId = this.serviceId(id);
    const current = await this.services.findById(tenantId, serviceId);
    if (!current) throw new ServiceNotFoundError();
    if (current.status === nextStatus) return current;
    if (!this.canTransition(current.status, nextStatus)) {
      throw new ServiceLifecycleConflictError();
    }

    const changedAt = new Date();
    const result = await this.services.changeStatusIfCurrent(
      tenantId,
      serviceId,
      current.status,
      nextStatus,
      changedAt,
    );
    if (result.kind === 'tenant-inactive') throw new TenantContextInvalidError();
    if (result.kind === 'not-found') throw new ServiceNotFoundError();
    if (result.kind === 'name-conflict') throw new ServiceNameConflictError();
    if (result.kind === 'code-conflict') throw new ServiceCodeConflictError();
    if (result.kind === 'conflict') throw new ServiceConflictError();
    if (result.kind === 'not-changed') {
      const latest = await this.services.findById(tenantId, serviceId);
      if (!latest) throw new ServiceNotFoundError();
      if (latest.status === nextStatus) return latest;
      throw new ServiceLifecycleConflictError();
    }
    const record = result.record;
    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.SERVICE_STATUS_CHANGED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenantId,
      ...requestContext,
      metadata: {
        targetType: 'SERVICE',
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

  private changedRecord(result: ServiceCatalogMutationResult): ServiceCatalogRecord {
    if (result.kind === 'changed') return result.record;
    if (result.kind === 'tenant-inactive') throw new TenantContextInvalidError();
    if (result.kind === 'not-found') throw new ServiceNotFoundError();
    if (result.kind === 'name-conflict') throw new ServiceNameConflictError();
    if (result.kind === 'code-conflict') throw new ServiceCodeConflictError();
    throw new ServiceConflictError();
  }

  private tenantId(context: TrustedTenantContext): string {
    if (!context) throw new TenantContextRequiredError();
    const tenantId = tenantIdSchema.safeParse(context.tenantId);
    if (
      !tenantId.success ||
      !z.string().uuid().safeParse(context.membershipId).success ||
      !z.string().uuid().safeParse(context.platformUserId).success
    ) {
      throw new TenantContextInvalidError();
    }
    return tenantId.data;
  }

  private serviceId(id: string): string {
    const parsed = serviceIdSchema.safeParse(id);
    if (!parsed.success) throw new ServiceIdInvalidError();
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
}
