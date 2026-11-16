import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Document } from 'mongodb';
import { PlatformMongoClientManager } from '../platform-mongo/platform-mongo.client.manager';
import { PlatformDocumentConflictError } from '../platform-mongo/platform-mongo.errors';
import {
  clinicWebsiteDraftSchema,
  clinicWebsiteRecordSchema,
  clinicWebsiteVersionSchema,
  defaultClinicWebsiteDraft,
  type ClinicWebsiteDraft,
  type ClinicWebsiteRecord,
  type ClinicWebsiteVersion,
} from './clinic-website.model';
import {
  ClinicWebsiteInputError,
  ClinicWebsiteNotPublishedError,
  ClinicWebsiteSlugConflictError,
  ClinicWebsiteVersionConflictError,
  ClinicWebsiteVersionNotFoundError,
} from './clinic-website.errors';

type WebsiteRow = Document & ClinicWebsiteRecord;
type VersionRow = Document & ClinicWebsiteVersion;

export interface ClinicWebsiteState {
  tenantId: string;
  currentVersion: number;
  publishedVersion: number | null;
  publishedAt: Date | null;
  status: 'DRAFT' | 'PUBLISHED';
  draft: ClinicWebsiteDraft;
}

export interface PublishedClinicWebsite {
  tenantId: string;
  version: number;
  draft: ClinicWebsiteDraft;
  publishedAt: Date;
}

@Injectable()
export class ClinicWebsiteStore {
  constructor(
    @Inject(PlatformMongoClientManager)
    private readonly mongo: PlatformMongoClientManager,
  ) {}

  async get(tenantId: string, actorId: string): Promise<ClinicWebsiteState> {
    const db = await this.mongo.getDatabase();
    const sites = db.collection<WebsiteRow>('clinic_website_sites');
    const now = new Date();
    const initial = this.newRecord(tenantId, actorId, now);
    await sites.updateOne({ _id: tenantId }, { $setOnInsert: initial }, { upsert: true });
    const raw = await sites.findOne({ _id: tenantId });
    return this.toState(this.parseRecord(raw));
  }

  async saveDraft(
    tenantId: string,
    actorId: string,
    expectedVersion: number,
    draftInput: unknown,
  ): Promise<ClinicWebsiteState> {
    const parsed = clinicWebsiteDraftSchema.safeParse(draftInput);
    if (!parsed.success) throw new ClinicWebsiteInputError();
    const draft = parsed.data;
    return this.mutate(
      tenantId,
      actorId,
      expectedVersion,
      'DRAFT_SAVED',
      (current, version, now) => ({
        ...current,
        version,
        draft,
        updatedAt: now,
        updatedBy: actorId,
      }),
    );
  }

  async publish(
    tenantId: string,
    actorId: string,
    expectedVersion: number,
  ): Promise<ClinicWebsiteState> {
    return this.mutate(
      tenantId,
      actorId,
      expectedVersion,
      'PUBLISHED',
      (current, version, now) => ({
        ...current,
        version,
        published: {
          version,
          slug: current.draft.slug,
          draft: current.draft,
          publishedAt: now,
          publishedBy: actorId,
        },
        updatedAt: now,
        updatedBy: actorId,
      }),
    );
  }

  async restore(
    tenantId: string,
    actorId: string,
    targetVersion: number,
    expectedVersion: number,
  ): Promise<ClinicWebsiteState> {
    const db = await this.mongo.getDatabase();
    const versionId = this.versionId(tenantId, targetVersion);
    const targetRaw = await db
      .collection<VersionRow>('clinic_website_versions')
      .findOne({ _id: versionId, tenantId });
    if (!targetRaw) throw new ClinicWebsiteVersionNotFoundError();
    const target = clinicWebsiteVersionSchema.parse(targetRaw);
    return this.mutate(
      tenantId,
      actorId,
      expectedVersion,
      'RESTORED',
      (current, version, now) => ({
        ...current,
        version,
        draft: target.draft,
        updatedAt: now,
        updatedBy: actorId,
      }),
      targetVersion,
    );
  }

  async listVersions(tenantId: string, limit = 50): Promise<ClinicWebsiteVersion[]> {
    const db = await this.mongo.getDatabase();
    const rows = await db
      .collection<VersionRow>('clinic_website_versions')
      .find({ tenantId })
      .sort({ version: -1 })
      .limit(limit)
      .toArray();
    return rows.map((row) => clinicWebsiteVersionSchema.parse(row));
  }

  async findPublishedBySlug(slug: string): Promise<PublishedClinicWebsite> {
    const db = await this.mongo.getDatabase();
    const raw = await db.collection<WebsiteRow>('clinic_website_sites').findOne({
      'published.slug': slug.toLowerCase(),
      'published.draft': { $exists: true },
    });
    if (!raw) throw new ClinicWebsiteNotPublishedError();
    const record = this.parseRecord(raw);
    if (!record.published) throw new ClinicWebsiteNotPublishedError();
    const activeTenant = await db.collection<{ _id: string; status: string }>('tenants').findOne({
      _id: record.tenantId,
      status: 'ACTIVE',
    });
    if (!activeTenant) throw new ClinicWebsiteNotPublishedError();
    return {
      tenantId: record.tenantId,
      version: record.published.version,
      draft: record.published.draft,
      publishedAt: record.published.publishedAt,
    };
  }

  private async mutate(
    tenantId: string,
    actorId: string,
    expectedVersion: number,
    action: ClinicWebsiteVersion['action'],
    update: (current: ClinicWebsiteRecord, nextVersion: number, now: Date) => ClinicWebsiteRecord,
    restoredFromVersion: number | null = null,
  ): Promise<ClinicWebsiteState> {
    const db = await this.mongo.getDatabase();
    const sites = db.collection<WebsiteRow>('clinic_website_sites');
    try {
      const record = await this.mongo.withTransaction(async (session) => {
        const currentRaw = await sites.findOne({ _id: tenantId }, { session });
        if (!currentRaw) throw new ClinicWebsiteVersionConflictError();
        const current = this.parseRecord(currentRaw);
        if (current.version !== expectedVersion) throw new ClinicWebsiteVersionConflictError();
        const now = new Date();
        const nextVersion = current.version + 1;
        const next = update(current, nextVersion, now);
        let result;
        try {
          result = await sites.replaceOne({ _id: tenantId, version: expectedVersion }, next, {
            session,
          });
        } catch (error) {
          if (isDuplicateKeyError(error)) throw new WebsiteStoreConflict('slug');
          throw error;
        }
        if (result.matchedCount !== 1) throw new ClinicWebsiteVersionConflictError();

        const versionRecord: ClinicWebsiteVersion = {
          _id: this.versionId(tenantId, nextVersion),
          tenantId,
          version: nextVersion,
          action,
          draft: next.draft,
          actorId,
          createdAt: now,
          restoredFromVersion,
        };
        await db.collection<VersionRow>('clinic_website_versions').insertOne(versionRecord, {
          session,
        });
        return next;
      });
      return this.toState(record);
    } catch (error) {
      if (error instanceof WebsiteStoreConflict) throw new ClinicWebsiteSlugConflictError();
      if (error instanceof PlatformDocumentConflictError) {
        throw new ClinicWebsiteVersionConflictError();
      }
      throw error;
    }
  }

  private newRecord(tenantId: string, actorId: string, now: Date): ClinicWebsiteRecord {
    const suffix = tenantId.replace(/-/gu, '');
    return {
      _id: tenantId,
      tenantId,
      version: 0,
      draft: defaultClinicWebsiteDraft(`clinic-${suffix}`),
      published: null,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    };
  }

  private parseRecord(raw: unknown): ClinicWebsiteRecord {
    return clinicWebsiteRecordSchema.parse(raw);
  }

  private toState(record: ClinicWebsiteRecord): ClinicWebsiteState {
    return {
      tenantId: record.tenantId,
      currentVersion: record.version,
      publishedVersion: record.published?.version ?? null,
      publishedAt: record.published?.publishedAt ?? null,
      status: record.published ? 'PUBLISHED' : 'DRAFT',
      draft: record.draft,
    };
  }

  private versionId(tenantId: string, version: number): string {
    return `${tenantId}:v${version}`;
  }
}

class WebsiteStoreConflict extends PlatformDocumentConflictError {
  constructor(readonly kind: 'slug') {
    super();
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export function newClinicWebsiteOperationId(): string {
  return randomUUID();
}
