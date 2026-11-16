import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformMongoModule } from '../platform-mongo/platform-mongo.module';
import { OperationsModule } from '../internal-operations/operations.module';
import { TenantStorageModule } from '../tenant/tenant-storage.module';
import { JourneyStore } from './journey.store';
import { JourneyAccounts } from './journey.accounts';
import { JourneyOrders } from './journey.orders';
import { JourneyDocuments } from './journey.documents';
import { JourneyAdmin } from './journey.admin';
import { JourneyBilling } from './journey.billing';
import { JourneyAccess } from './journey.access';
import { JourneyInquiries } from './journey.inquiries';
import { JourneyIntegrations } from './journey.integrations';
import {
  JourneyAdminInquiryController,
  JourneyPublicInquiryController,
} from './journey.inquiry.controller';
import {
  JourneyAdminController,
  JourneyCustomerController,
  JourneyPublicController,
} from './journey.controller';
@Module({
  imports: [AuthModule, PlatformMongoModule, OperationsModule, TenantStorageModule],
  providers: [
    JourneyStore,
    JourneyAccounts,
    JourneyOrders,
    JourneyDocuments,
    JourneyAdmin,
    JourneyBilling,
    JourneyAccess,
    JourneyInquiries,
    JourneyIntegrations,
  ],
  controllers: [
    JourneyPublicController,
    JourneyCustomerController,
    JourneyAdminController,
    JourneyPublicInquiryController,
    JourneyAdminInquiryController,
  ],
})
export class CustomerJourneyModule {}
