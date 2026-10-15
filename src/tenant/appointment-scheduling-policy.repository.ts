import { Injectable } from '@nestjs/common';
import {
  FacilitySchedulingPolicyRevisionAction,
  FacilitySchedulingPolicyStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { SchedulingPolicyRules } from './appointment-scheduling-policy.dto';
import { SchedulingPolicyVersionConflictError } from './appointment-scheduling-policy.errors';

export type FacilitySchedulingPolicyRecord = {
  id: string;
  tenantId: string;
  facilityId: string;
  status: FacilitySchedulingPolicyStatus;
  timeZone: string;
  rules: Prisma.JsonValue;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type FacilitySchedulingPolicyRevisionRecord = {
  id: string;
  policyId: string;
  tenantId: string;
  facilityId: string;
  version: number;
  action: FacilitySchedulingPolicyRevisionAction;
  status: FacilitySchedulingPolicyStatus;
  timeZone: string;
  rules: Prisma.JsonValue;
  actorUserId: string;
  createdAt: Date;
};

@Injectable()
export class FacilitySchedulingPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByFacility(
    tenantId: string,
    facilityId: string,
  ): Promise<FacilitySchedulingPolicyRecord | null> {
    return this.prisma.facilitySchedulingPolicy.findUnique({
      where: { facilityId_tenantId: { tenantId, facilityId } },
    });
  }

  findActiveByFacility(
    tenantId: string,
    facilityId: string,
  ): Promise<FacilitySchedulingPolicyRecord | null> {
    return this.prisma.facilitySchedulingPolicy.findFirst({
      where: {
        tenantId,
        facilityId,
        status: FacilitySchedulingPolicyStatus.ACTIVE,
      },
    });
  }

  async upsert(input: {
    tenantId: string;
    facilityId: string;
    expectedVersion?: number;
    timeZone: string;
    rules: SchedulingPolicyRules;
    actorUserId: string;
  }): Promise<{ policy: FacilitySchedulingPolicyRecord; changed: boolean }> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.facilitySchedulingPolicy.findUnique({
        where: {
          facilityId_tenantId: {
            facilityId: input.facilityId,
            tenantId: input.tenantId,
          },
        },
      });
      if (!current) {
        if (input.expectedVersion !== undefined) {
          throw new SchedulingPolicyVersionConflictError();
        }
        const policy = await transaction.facilitySchedulingPolicy.create({
          data: {
            tenantId: input.tenantId,
            facilityId: input.facilityId,
            status: FacilitySchedulingPolicyStatus.INACTIVE,
            timeZone: input.timeZone,
            rules: asPrismaJson(input.rules),
            version: 1,
          },
        });
        await this.createRevision(
          transaction,
          policy,
          input.actorUserId,
          FacilitySchedulingPolicyRevisionAction.CREATED,
        );
        return { policy, changed: true };
      }
      if (input.expectedVersion === undefined || input.expectedVersion !== current.version) {
        throw new SchedulingPolicyVersionConflictError();
      }

      const version = current.version + 1;
      const updated = await transaction.facilitySchedulingPolicy.updateMany({
        where: {
          id: current.id,
          tenantId: input.tenantId,
          version: current.version,
        },
        data: {
          timeZone: input.timeZone,
          rules: asPrismaJson(input.rules),
          version,
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new SchedulingPolicyVersionConflictError();
      const policy = await transaction.facilitySchedulingPolicy.findUniqueOrThrow({
        where: { id_tenantId: { id: current.id, tenantId: input.tenantId } },
      });
      await this.createRevision(
        transaction,
        policy,
        input.actorUserId,
        FacilitySchedulingPolicyRevisionAction.UPDATED,
      );
      return { policy, changed: true };
    });
  }

  async setStatus(input: {
    tenantId: string;
    facilityId: string;
    expectedVersion: number;
    status: FacilitySchedulingPolicyStatus;
    actorUserId: string;
  }): Promise<{
    policy: FacilitySchedulingPolicyRecord | null;
    changed: boolean;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.facilitySchedulingPolicy.findUnique({
        where: {
          facilityId_tenantId: {
            facilityId: input.facilityId,
            tenantId: input.tenantId,
          },
        },
      });
      if (!current) return { policy: null, changed: false };
      if (current.version !== input.expectedVersion) {
        throw new SchedulingPolicyVersionConflictError();
      }
      if (current.status === input.status) return { policy: current, changed: false };

      const version = current.version + 1;
      const changed = await transaction.facilitySchedulingPolicy.updateMany({
        where: {
          id: current.id,
          tenantId: input.tenantId,
          version: current.version,
        },
        data: {
          status: input.status,
          version,
          updatedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new SchedulingPolicyVersionConflictError();
      const policy = await transaction.facilitySchedulingPolicy.findUniqueOrThrow({
        where: { id_tenantId: { id: current.id, tenantId: input.tenantId } },
      });
      const action =
        input.status === FacilitySchedulingPolicyStatus.ACTIVE
          ? FacilitySchedulingPolicyRevisionAction.ACTIVATED
          : FacilitySchedulingPolicyRevisionAction.DEACTIVATED;
      await this.createRevision(transaction, policy, input.actorUserId, action);
      return { policy, changed: true };
    });
  }

  async listRevisions(
    tenantId: string,
    facilityId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FacilitySchedulingPolicyRevisionRecord[]; total: number }> {
    const where = { tenantId, facilityId };
    const [items, total] = await Promise.all([
      this.prisma.facilitySchedulingPolicyRevision.findMany({
        where,
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.facilitySchedulingPolicyRevision.count({ where }),
    ]);
    return { items, total };
  }

  private createRevision(
    transaction: Prisma.TransactionClient,
    policy: FacilitySchedulingPolicyRecord,
    actorUserId: string,
    action: FacilitySchedulingPolicyRevisionAction,
  ): Promise<FacilitySchedulingPolicyRevisionRecord> {
    return transaction.facilitySchedulingPolicyRevision.create({
      data: {
        policyId: policy.id,
        tenantId: policy.tenantId,
        facilityId: policy.facilityId,
        version: policy.version,
        action,
        status: policy.status,
        timeZone: policy.timeZone,
        rules: asPrismaJson(policy.rules),
        actorUserId,
      },
    });
  }
}

function asPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
