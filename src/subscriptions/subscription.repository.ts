import { Injectable } from '@nestjs/common';
import { PlanStatus, Prisma, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  decideSubscriptionTransition,
  type SubscriptionLifecycleAction,
} from './subscription.rules';

const subscriptionSelect = {
  id: true,
  tenantId: true,
  planId: true,
  status: true,
  startsAt: true,
  endsAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubscriptionSelect;

export type SubscriptionRecord = Prisma.SubscriptionGetPayload<{
  select: typeof subscriptionSelect;
}>;

export interface SubscriptionListFilter {
  tenantId?: string;
  status?: SubscriptionStatus;
  limit: number;
  offset: number;
}

export interface CreateSubscriptionRecordInput {
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
}

export type CreateSubscriptionResult =
  | { kind: 'created'; subscription: SubscriptionRecord }
  | { kind: 'tenant-not-found' }
  | { kind: 'tenant-unavailable' }
  | { kind: 'plan-not-found' }
  | { kind: 'plan-unavailable' }
  | { kind: 'period-conflict' };

export type TransitionSubscriptionResult =
  | { kind: 'updated'; subscription: SubscriptionRecord; previousStatus: SubscriptionStatus }
  | { kind: 'not-found' }
  | { kind: 'tenant-unavailable' }
  | { kind: 'period-conflict' }
  | { kind: 'transition-invalid' };

interface LockedTenantRow {
  id: string;
  status: TenantStatus;
}

interface LockedPlanRow {
  id: string;
  status: PlanStatus;
}

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<SubscriptionRecord | null> {
    return this.prisma.subscription.findUnique({ where: { id }, select: subscriptionSelect });
  }

  list(filter: SubscriptionListFilter): Promise<SubscriptionRecord[]> {
    return this.prisma.subscription.findMany({
      where: {
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: filter.offset,
      take: filter.limit,
      select: subscriptionSelect,
    });
  }

  findCurrentForTenant(tenantId: string, asOf: Date): Promise<SubscriptionRecord[]> {
    return this.prisma.subscription.findMany({
      where: {
        tenantId,
        status: SubscriptionStatus.ACTIVE,
        startsAt: { lte: asOf },
        OR: [{ endsAt: null }, { endsAt: { gt: asOf } }],
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: subscriptionSelect,
    });
  }

  createForActiveTenantAndPlan(
    input: CreateSubscriptionRecordInput,
  ): Promise<CreateSubscriptionResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        const tenantRows = await transaction.$queryRaw<LockedTenantRow[]>(
          Prisma.sql`
            SELECT \`id\`, \`status\`
            FROM \`Tenant\`
            WHERE \`id\` = ${input.tenantId}
            FOR UPDATE
          `,
        );
        const tenant = tenantRows[0];
        if (!tenant) return { kind: 'tenant-not-found' };
        if (tenant.status !== TenantStatus.ACTIVE) return { kind: 'tenant-unavailable' };

        const planRows = await transaction.$queryRaw<LockedPlanRow[]>(
          Prisma.sql`
            SELECT \`id\`, \`status\`
            FROM \`Plan\`
            WHERE \`id\` = ${input.planId}
            FOR UPDATE
          `,
        );
        const plan = planRows[0];
        if (!plan) return { kind: 'plan-not-found' };
        if (plan.status !== PlanStatus.ACTIVE) return { kind: 'plan-unavailable' };

        if (
          input.status === SubscriptionStatus.ACTIVE &&
          (await this.findOverlappingActive(
            transaction,
            input.tenantId,
            input.startsAt,
            input.endsAt,
          ))
        ) {
          return { kind: 'period-conflict' };
        }

        const subscription = await transaction.subscription.create({
          data: {
            tenantId: input.tenantId,
            planId: input.planId,
            status: input.status,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
          select: subscriptionSelect,
        });
        return { kind: 'created', subscription };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async transition(
    id: string,
    action: SubscriptionLifecycleAction,
    now: Date,
  ): Promise<TransitionSubscriptionResult> {
    const discovered = await this.prisma.subscription.findUnique({
      where: { id },
      select: { tenantId: true },
    });
    if (!discovered) return { kind: 'not-found' };

    return this.prisma.$transaction(
      async (transaction) => {
        const tenantRows = await transaction.$queryRaw<LockedTenantRow[]>(
          Prisma.sql`
            SELECT \`id\`, \`status\`
            FROM \`Tenant\`
            WHERE \`id\` = ${discovered.tenantId}
            FOR UPDATE
          `,
        );
        const tenant = tenantRows[0];
        if (!tenant) return { kind: 'not-found' };

        const current = await transaction.subscription.findFirst({
          where: { id, tenantId: discovered.tenantId },
          select: subscriptionSelect,
        });
        if (!current) return { kind: 'not-found' };

        const decision = decideSubscriptionTransition(current, action, tenant.status, now);
        if (decision.kind === 'invalid-transition') return { kind: 'transition-invalid' };
        if (decision.kind === 'tenant-unavailable') return { kind: 'tenant-unavailable' };

        if (
          decision.status === SubscriptionStatus.ACTIVE &&
          (await this.findOverlappingActive(
            transaction,
            current.tenantId,
            current.startsAt,
            current.endsAt,
            current.id,
          ))
        ) {
          return { kind: 'period-conflict' };
        }

        const updated = await transaction.subscription.updateMany({
          where: { id: current.id, tenantId: current.tenantId, status: current.status },
          data: {
            status: decision.status,
            cancelledAt: decision.cancelledAt,
            updatedAt: now,
          },
        });
        if (updated.count !== 1) return { kind: 'transition-invalid' };

        const subscription = await transaction.subscription.findFirst({
          where: { id: current.id, tenantId: current.tenantId },
          select: subscriptionSelect,
        });
        if (!subscription) return { kind: 'not-found' };
        return {
          kind: 'updated',
          subscription,
          previousStatus: current.status,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private findOverlappingActive(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    startsAt: Date,
    endsAt: Date | null,
    excludingId?: string,
  ): Promise<{ id: string } | null> {
    const where: Prisma.SubscriptionWhereInput = {
      tenantId,
      status: SubscriptionStatus.ACTIVE,
      ...(excludingId ? { id: { not: excludingId } } : {}),
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] },
        ...(endsAt ? [{ startsAt: { lt: endsAt } }] : []),
      ],
    };
    return transaction.subscription.findFirst({ where, select: { id: true } });
  }
}
