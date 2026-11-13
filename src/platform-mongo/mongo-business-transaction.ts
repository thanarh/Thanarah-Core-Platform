import { HttpException } from '@nestjs/common';
import { PlatformDocumentValidationError } from './platform-mongo.errors';
import { MongoTenantAuthorizationContext } from './mongo-tenant-authorization.context';
import type { PlatformMongoClientManager } from './platform-mongo.client.manager';

class BusinessRejection extends PlatformDocumentValidationError {
  constructor(readonly rejection: HttpException) {
    super();
  }
}

/** Preserve intentional public domain rejections without exposing driver errors. */
export async function mongoBusinessTransaction<T>(
  manager: PlatformMongoClientManager,
  operation: (tx: MongoTenantAuthorizationContext) => Promise<T>,
): Promise<T> {
  try {
    return await MongoTenantAuthorizationContext.run(manager, async (tx) => {
      try {
        return await operation(tx);
      } catch (error) {
        if (error instanceof HttpException) throw new BusinessRejection(error);
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof BusinessRejection) throw error.rejection;
    throw error;
  }
}
