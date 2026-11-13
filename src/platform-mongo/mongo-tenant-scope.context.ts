import type { BranchDocument, FacilityDocument } from './platform-mongo.models';
import { branchSchema, facilitySchema } from './platform-mongo.models';
import type { MongoTenantAuthorizationContext } from './mongo-tenant-authorization.context';
import { parseMongoDocument } from './mongo-tenant-authorization.context';

export async function mongoFacility(
  tx: MongoTenantAuthorizationContext,
  tenantId: string,
  id: string,
  lock = false,
): Promise<FacilityDocument | null> {
  if (lock && !(await tx.touch('facilities', id, { tenantId }))) return null;
  const row = await tx.db
    .collection<FacilityDocument>('facilities')
    .findOne({ _id: id, tenantId }, { session: tx.session });
  return row ? parseMongoDocument(facilitySchema, row) : null;
}

export async function mongoBranch(
  tx: MongoTenantAuthorizationContext,
  tenantId: string,
  id: string,
  lock = false,
): Promise<{ branch: BranchDocument; facility: FacilityDocument } | null> {
  const row = await tx.db
    .collection<BranchDocument>('branches')
    .findOne({ _id: id }, { session: tx.session });
  if (!row) return null;
  const branch = parseMongoDocument(branchSchema, row);
  const facility = await mongoFacility(tx, tenantId, branch.facilityId, lock);
  if (!facility) return null;
  if (lock && !(await tx.touch('branches', id, { facilityId: facility._id }))) return null;
  return { branch, facility };
}
