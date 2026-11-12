import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  FacilitySchedulingPolicyPersistencePort,
  FacilitySchedulingPolicyRecord,
  FacilitySchedulingPolicyRevisionRecord,
} from '../persistence/platform-persistence.ports';
import { schedulingPolicyRulesSchema } from '../tenant/appointment-scheduling-policy.dto';
import {
  SchedulingPolicyReferenceInvalidError,
  SchedulingPolicyVersionConflictError,
} from '../tenant/appointment-scheduling-policy.errors';
import { PlatformMongoClientManager } from './platform-mongo.client.manager';
import {
  PlatformDocumentConflictError,
  PlatformDocumentValidationError,
} from './platform-mongo.errors';
import { documentTimestamps, newStableId } from './platform-mongo.models';
import {
  MongoTenantAuthorizationContext as Context,
  parseMongoDocument,
} from './mongo-tenant-authorization.context';

const policySchema = z
  .object({
    _id: z.string().uuid(),
    tenantId: z.string().uuid(),
    facilityId: z.string().uuid(),
    status: z.enum(['ACTIVE', 'INACTIVE']),
    timeZone: z.string().min(1),
    rules: schedulingPolicyRulesSchema,
    version: z.number().int().positive(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
const revisionSchema = policySchema
  .omit({ updatedAt: true })
  .extend({
    policyId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    action: z.enum(['CREATED', 'UPDATED', 'ACTIVATED', 'DEACTIVATED']),
  })
  .strict();
type PolicyDocument = z.infer<typeof policySchema>;
type RevisionDocument = z.infer<typeof revisionSchema>;
class PolicyReferenceConflict extends PlatformDocumentValidationError {}

@Injectable()
export class MongoFacilitySchedulingPolicyRepository implements FacilitySchedulingPolicyPersistencePort {
  constructor(private readonly manager: PlatformMongoClientManager) {}

  findByFacility(
    tenantId: string,
    facilityId: string,
  ): Promise<FacilitySchedulingPolicyRecord | null> {
    return Context.run(this.manager, async (tx) => {
      const row = await this.current(tx, tenantId, facilityId);
      return row ? this.record(row) : null;
    });
  }

  async findActiveByFacility(
    tenantId: string,
    facilityId: string,
  ): Promise<FacilitySchedulingPolicyRecord | null> {
    const policy = await this.findByFacility(tenantId, facilityId);
    return policy?.status === 'ACTIVE' ? policy : null;
  }

  findActiveTimeZonesByFacilities(
    tenantId: string,
    facilityIds: string[],
  ): Promise<Array<{ facilityId: string; timeZone: string }>> {
    return Context.run(this.manager, async (tx) => {
      const rows = await tx.db
        .collection<PolicyDocument>('facility_scheduling_policies')
        .find(
          { tenantId, facilityId: { $in: facilityIds }, status: 'ACTIVE' },
          { session: tx.session },
        )
        .toArray();
      return rows.map((row) => {
        const policy = parseMongoDocument(policySchema, row);
        return { facilityId: policy.facilityId, timeZone: policy.timeZone };
      });
    });
  }

  async upsert(
    input: Parameters<FacilitySchedulingPolicyPersistencePort['upsert']>[0],
  ): Promise<{ policy: FacilitySchedulingPolicyRecord; changed: boolean }> {
    try {
      return await Context.run(this.manager, async (tx) => {
        await this.references(tx, input.tenantId, input.facilityId, input.actorUserId);
        const current = await this.current(tx, input.tenantId, input.facilityId);
        if (
          current ? input.expectedVersion !== current.version : input.expectedVersion !== undefined
        ) {
          throw new PlatformDocumentConflictError();
        }
        const now = new Date();
        const policy = parseMongoDocument(policySchema, {
          _id: current?._id ?? newStableId(),
          tenantId: input.tenantId,
          facilityId: input.facilityId,
          ...documentTimestamps(now),
          createdAt: current?.createdAt ?? now,
          status: current?.status ?? 'INACTIVE',
          version: (current?.version ?? 0) + 1,
          timeZone: input.timeZone,
          rules: input.rules,
        });
        const collection = tx.db.collection<PolicyDocument>('facility_scheduling_policies');
        if (current) {
          const result = await collection.replaceOne(
            {
              _id: current._id,
              tenantId: input.tenantId,
              version: current.version,
            },
            policy,
            { session: tx.session },
          );
          if (result.matchedCount !== 1) throw new PlatformDocumentConflictError();
        } else await collection.insertOne(policy, { session: tx.session });
        await this.revision(tx, policy, input.actorUserId, current ? 'UPDATED' : 'CREATED');
        return { policy: this.record(policy), changed: true };
      });
    } catch (error) {
      return this.rethrow(error);
    }
  }

  async setStatus(
    input: Parameters<FacilitySchedulingPolicyPersistencePort['setStatus']>[0],
  ): Promise<{ policy: FacilitySchedulingPolicyRecord | null; changed: boolean }> {
    try {
      return await Context.run(this.manager, async (tx) => {
        const current = await this.current(tx, input.tenantId, input.facilityId);
        if (!current) return { policy: null, changed: false };
        await this.references(tx, input.tenantId, input.facilityId, input.actorUserId);
        if (current.version !== input.expectedVersion) throw new PlatformDocumentConflictError();
        if (current.status === input.status)
          return { policy: this.record(current), changed: false };
        const policy = {
          ...current,
          status: input.status,
          version: current.version + 1,
          updatedAt: new Date(),
        };
        const result = await tx.db
          .collection<PolicyDocument>('facility_scheduling_policies')
          .replaceOne(
            { _id: current._id, tenantId: input.tenantId, version: current.version },
            policy,
            { session: tx.session },
          );
        if (result.matchedCount !== 1) throw new PlatformDocumentConflictError();
        await this.revision(
          tx,
          policy,
          input.actorUserId,
          input.status === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED',
        );
        return { policy: this.record(policy), changed: true };
      });
    } catch (error) {
      return this.rethrow(error);
    }
  }

  listRevisions(
    tenantId: string,
    facilityId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FacilitySchedulingPolicyRevisionRecord[]; total: number }> {
    return Context.run(this.manager, async (tx) => {
      const collection = tx.db.collection<RevisionDocument>('facility_scheduling_policy_revisions');
      const filter = { tenantId, facilityId };
      const rows = await collection
        .find(filter, { session: tx.session })
        .sort({ version: -1, _id: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      const total = await collection.countDocuments(filter, { session: tx.session });
      const items = rows.map((row) => {
        const { _id, ...fields } = parseMongoDocument(revisionSchema, row);
        return { id: _id, ...fields };
      });
      return { items, total };
    });
  }

  private async current(
    tx: Context,
    tenantId: string,
    facilityId: string,
  ): Promise<PolicyDocument | null> {
    const row = await tx.db
      .collection<PolicyDocument>('facility_scheduling_policies')
      .findOne({ tenantId, facilityId }, { session: tx.session });
    return row ? parseMongoDocument(policySchema, row) : null;
  }

  private async references(
    tx: Context,
    tenantId: string,
    facilityId: string,
    actorUserId: string,
  ): Promise<void> {
    if (
      !(await tx.activeTenant(tenantId, true)) ||
      !(await tx.touch('facilities', facilityId, { tenantId, status: 'ACTIVE' })) ||
      !(await tx.touch('platform_users', actorUserId, { status: 'ACTIVE' }))
    )
      throw new PolicyReferenceConflict();
  }

  private async revision(
    tx: Context,
    policy: PolicyDocument,
    actorUserId: string,
    action: RevisionDocument['action'],
  ): Promise<void> {
    const { updatedAt, ...fields } = policy;
    const row = parseMongoDocument(revisionSchema, {
      ...fields,
      _id: newStableId(),
      policyId: policy._id,
      actorUserId,
      action,
      createdAt: updatedAt,
    });
    await tx.db
      .collection<RevisionDocument>('facility_scheduling_policy_revisions')
      .insertOne(row, { session: tx.session });
  }

  private record(row: PolicyDocument): FacilitySchedulingPolicyRecord {
    const { _id, ...fields } = parseMongoDocument(policySchema, row);
    return { id: _id, ...fields };
  }

  private rethrow(error: unknown): never {
    if (error instanceof PlatformDocumentConflictError)
      throw new SchedulingPolicyVersionConflictError();
    if (error instanceof PolicyReferenceConflict) throw new SchedulingPolicyReferenceInvalidError();
    throw error;
  }
}
