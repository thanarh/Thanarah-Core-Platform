import { Inject, Injectable } from '@nestjs/common';
import { PlatformAuditEventType, Prisma, TenantStatus } from '@prisma/client';
import type { AuthenticatedPlatformUser } from '../auth/auth.types';
import {
  changeTenantStatusSchema,
  createTenantSchema,
  listTenantsQuerySchema,
  tenantIdSchema,
  type CreateTenantInput,
  type ListTenantsQuery,
} from './tenant.dto';
import {
  TenantIdInvalidError,
  TenantInputValidationError,
  TenantLifecycleConflictError,
  TenantNotFoundError,
  TenantSlugConflictError,
} from './tenant.errors';
import {
  TENANT_PERSISTENCE,
  type TenantPersistencePort,
} from '../persistence/platform-persistence.ports';
import type { TenantRecord } from './tenant.repository';
import { PlatformAuditService } from '../platform-security/platform-audit.service';
import type { TrustedSecurityContext } from '../platform-security/platform-security.types';

export type TenantRequestAuditContext = Pick<
  TrustedSecurityContext,
  'requestId' | 'ipAddress' | 'userAgent'
>;

@Injectable()
export class TenantService {
  constructor(
    @Inject(TENANT_PERSISTENCE) private readonly tenants: TenantPersistencePort,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    input: CreateTenantInput,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRequestAuditContext = {},
  ): Promise<TenantRecord> {
    const parsed = createTenantSchema.safeParse(input);
    if (!parsed.success) throw new TenantInputValidationError();

    const tenantInput = {
      slug: parsed.data.slug,
      legalName: parsed.data.legalName,
      displayName: parsed.data.displayName ?? parsed.data.legalName,
    };

    if (await this.tenants.findBySlug(tenantInput.slug)) {
      throw new TenantSlugConflictError();
    }

    let tenant: TenantRecord;
    try {
      tenant = await this.tenants.create(tenantInput);
    } catch (error) {
      if (this.isSlugConflict(error)) throw new TenantSlugConflictError();
      throw error;
    }

    await this.audit.recordAudit({
      eventType: PlatformAuditEventType.TENANT_CREATED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: tenant.id,
      ...requestContext,
      metadata: { tenantSlug: tenant.slug, status: tenant.status },
    });

    return tenant;
  }

  async list(query: ListTenantsQuery): Promise<{
    items: TenantRecord[];
    limit: number;
    offset: number;
  }> {
    const parsed = listTenantsQuerySchema.safeParse(query);
    if (!parsed.success) throw new TenantInputValidationError();
    const { status, limit, offset } = parsed.data;
    const items = await this.tenants.list({ status, limit, offset });
    return { items, limit, offset };
  }

  async findById(id: string): Promise<TenantRecord> {
    this.assertTenantId(id);
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw new TenantNotFoundError();
    return tenant;
  }

  async changeStatus(
    id: string,
    nextStatus: TenantStatus,
    actor: AuthenticatedPlatformUser,
    requestContext: TenantRequestAuditContext = {},
  ): Promise<TenantRecord> {
    this.assertTenantId(id);
    const statusInput = changeTenantStatusSchema.safeParse({ status: nextStatus });
    if (!statusInput.success) throw new TenantInputValidationError();

    const current = await this.tenants.findById(id);
    if (!current) throw new TenantNotFoundError();
    if (current.status === nextStatus) return current;
    if (!this.canTransition(current.status, nextStatus)) {
      throw new TenantLifecycleConflictError();
    }

    const changedAt = new Date();
    const updated = await this.tenants.changeStatusIfCurrent(
      id,
      current.status,
      nextStatus,
      changedAt,
    );

    if (!updated) {
      const latest = await this.tenants.findById(id);
      if (!latest) throw new TenantNotFoundError();
      if (latest.status === nextStatus) return latest;
      throw new TenantLifecycleConflictError();
    }

    await this.audit.recordAudit({
      eventType:
        nextStatus === TenantStatus.DEACTIVATED
          ? PlatformAuditEventType.TENANT_DEACTIVATED
          : PlatformAuditEventType.TENANT_STATUS_CHANGED,
      actorUserId: actor.userId,
      sessionId: actor.sessionId,
      subjectTenantId: updated.id,
      ...requestContext,
      metadata: {
        tenantSlug: updated.slug,
        fromStatus: current.status,
        toStatus: updated.status,
      },
    });

    return updated;
  }

  private assertTenantId(id: string): void {
    if (!tenantIdSchema.safeParse(id).success) throw new TenantIdInvalidError();
  }

  private canTransition(current: TenantStatus, next: TenantStatus): boolean {
    if (current === TenantStatus.ACTIVE) {
      return next === TenantStatus.SUSPENDED || next === TenantStatus.DEACTIVATED;
    }
    if (current === TenantStatus.SUSPENDED) {
      return next === TenantStatus.ACTIVE || next === TenantStatus.DEACTIVATED;
    }
    return false;
  }

  private isSlugConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }

    const target = error.meta?.target;
    const targets = Array.isArray(target) ? target : [target];
    return targets.some((value) => typeof value === 'string' && /slug/i.test(value));
  }
}
