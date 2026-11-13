import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail } from '../internal-operations/operations.errors';
import {
  createOrderSchema,
  customerActionSchema,
  documentSchema,
  invoiceSchema,
  orderSchema,
  reviewSchema,
  command,
  type Order,
} from './journey.model';
import {
  JourneyStore,
  collection,
  expectVersion,
  parse,
  stored,
  type JourneyTx,
} from './journey.store';
import { canonical } from '../internal-operations/operations.store';
import { JourneyAccess } from './journey.access';
import { accountSchema } from './journey.model';
@Injectable()
export class JourneyOrders {
  constructor(
    readonly store: JourneyStore,
    readonly access: JourneyAccess,
  ) {}
  async create(userId: string, input: unknown): Promise<Order> {
    const data = parse(createOrderSchema, input);
    return this.store.command(
      userId,
      data.operationId,
      'customer.order.create',
      data,
      async (tx) => {
        const account = await this.store.account(tx, userId);
        if (!account.profile) fail('CUSTOMER_PROFILE_REQUIRED', 'أكمل ملف المنشأة أولًا.');
        const catalog = await this.store.catalog(tx);
        if (!catalog.live || !catalog.publishedBy || !catalog.publishedAt)
          fail(
            'CUSTOMER_CATALOG_UNPUBLISHED',
            'لم تعتمد شروط الباقات والوثائق بعد. يمكنك حفظ ملف المنشأة.',
          );
        const selected = catalog.live.packages.find(
          (x) => x.code === data.packageCode && x.published,
        );
        if (!catalog.live.registrationOpen && !data.parentOrderId)
          fail('CUSTOMER_REGISTRATION_CLOSED', 'استقبال طلبات العملاء الجدد مغلق حاليًا.', 403);
        if (!selected) fail('CUSTOMER_PACKAGE_UNAVAILABLE', 'الباقة غير متاحة حاليًا.');
        if (
          await collection(tx, 'customer_orders').findOne(
            { customerId: account._id, open: true },
            { session: tx.session },
          )
        )
          fail('CUSTOMER_OPEN_ORDER_EXISTS', 'لديك طلب مفتوح بالفعل؛ تابعه قبل إنشاء طلب آخر.');
        const delivered = await collection(tx, 'customer_orders').findOne(
          {
            customerId: account._id,
            status: 'DELIVERED',
          },
          { session: tx.session, sort: { deliveredAt: -1 } },
        );
        let parent: Order | null = null;
        if (data.parentOrderId) {
          parent = await this.store.order(tx, data.parentOrderId, account._id);
          if (parent.status !== 'DELIVERED' || delivered?._id !== parent._id)
            fail('CUSTOMER_RENEWAL_PARENT_INVALID', 'التجديد يبدأ من أحدث حساب مستلم.');
        } else if (delivered) fail('CUSTOMER_RENEWAL_REQUIRED', 'استخدم تجديد أحدث حساب مستلم.');
        const now = new Date();
        const order = orderSchema.parse({
          _id: randomUUID(),
          customerId: account._id,
          version: 1,
          purpose: parent ? 'RENEWAL' : 'NEW',
          packageCode: selected.code,
          packageSnapshot: selected,
          requirements: catalog.live.documents,
          termsVersion: catalog.liveVersion,
          termsText: catalog.live.termsText,
          profile: account.profile,
          status: 'DRAFT',
          open: true,
          managerId: null,
          clientId: parent?.clientId ?? null,
          tenantId: parent?.tenantId ?? null,
          subscriptionId: null,
          parentOrderId: parent?._id ?? null,
          reason: null,
          createdAt: now,
          updatedAt: now,
          approvedBy: null,
          activatedBy: null,
          deliveredAt: null,
        });
        await collection(tx, 'customer_orders').insertOne(order, { session: tx.session });
        return { result: order, orderId: order._id };
      },
    );
  }
  async detail(tx: JourneyTx, order: Order) {
    const documents = await collection(tx, 'customer_documents')
      .find(
        { orderId: order._id, superseded: false },
        { session: tx.session, projection: { bytes: 0 } },
      )
      .sort({ key: 1 })
      .toArray();
    // Projection intentionally removes bytes; validate all other fields separately.
    const safeDocuments = documents.map((raw) => {
      const checked = documentSchema.omit({ bytes: true }).safeParse(raw);
      if (!checked.success) fail('CUSTOMER_DATA_INVALID', 'تعذر قراءة الوثائق بأمان.', 503);
      return checked.data;
    });
    const events = await collection(tx, 'customer_events')
      .find({ orderId: order._id }, { session: tx.session })
      .sort({ at: 1, _id: 1 })
      .limit(500)
      .toArray();
    const invoices = await collection(tx, 'customer_invoices')
      .find({ orderId: order._id }, { session: tx.session })
      .sort({ createdAt: -1 })
      .toArray();
    const review = await collection(tx, 'customer_reviews').findOne(
      { orderId: order._id },
      { session: tx.session },
    );
    let deliveryAvailable = false;
    if (order.status === 'ACTIVE' || order.status === 'DELIVERED') {
      // Revalidate actual access even after handoff: suspension must remove the link.
      const account = stored(
        accountSchema,
        await collection(tx, 'customer_accounts').findOne(
          { _id: order.customerId },
          { session: tx.session },
        ),
      );
      deliveryAvailable = await this.access.available(tx, account, order);
    }
    return {
      order,
      documents: safeDocuments,
      events,
      invoices: invoices.map((x) => stored(invoiceSchema, x)),
      review: review ? stored(reviewSchema, review) : null,
      delivery: { available: deliveryAvailable, url: deliveryAvailable ? '/clinic-setup/' : null },
    };
  }
  async get(userId: string, id: string) {
    return this.store.run(async (tx) => {
      const account = await this.store.account(tx, userId);
      return this.detail(tx, await this.store.order(tx, id, account._id));
    });
  }
  async action(userId: string, id: string, input: unknown): Promise<Order> {
    const data = parse(customerActionSchema, input);
    return this.store.command(
      userId,
      data.operationId,
      `customer.order.${data.action}`,
      { id, ...data },
      async (tx) => {
        const account = await this.store.account(tx, userId);
        const order = await this.store.order(tx, id, account._id);
        expectVersion(order.version, data.version);
        let status: Order['status'];
        if (data.action === 'submit') {
          if (!['DRAFT', 'CHANGES_REQUESTED'].includes(order.status))
            fail('CUSTOMER_TRANSITION_INVALID', 'لا يمكن إرسال الطلب من حالته الحالية.');
          if (data.acceptedTermsVersion !== order.termsVersion)
            fail('CUSTOMER_TERMS_REQUIRED', 'يلزم قبول شروط هذا الطلب صراحةً قبل إرساله.');
          if (!account.profile) fail('CUSTOMER_PROFILE_REQUIRED', 'أكمل ملف المنشأة.');
          const docs = await collection(tx, 'customer_documents')
            .find({ orderId: id, superseded: false }, { session: tx.session })
            .toArray();
          const checked = docs.map((x) => stored(documentSchema, x));
          if (order.requirements.some((r) => r.required && !checked.some((d) => d.key === r.key)))
            fail('CUSTOMER_DOCUMENTS_REQUIRED', 'ارفع جميع الوثائق المطلوبة أولًا.');
          if (canonical(account.profile) !== canonical(order.profile)) {
            await collection(tx, 'customer_documents').updateMany(
              { orderId: id, superseded: false },
              {
                $set: { status: 'PENDING', reason: null, reviewedAt: null, reviewedBy: null },
                $inc: { version: 1 },
              },
              { session: tx.session },
            );
          }
          status = 'SUBMITTED';
        } else if (data.action === 'cancel') {
          if (!['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED'].includes(order.status))
            fail('CUSTOMER_TRANSITION_INVALID', 'لا يمكن إلغاء الطلب من حالته الحالية.');
          status = 'CANCELLED';
        } else {
          if (
            order.status !== 'ACTIVE' ||
            !order.activatedBy ||
            !account.profile ||
            canonical(account.profile) !== canonical(order.profile)
          )
            fail('CUSTOMER_DELIVERY_NOT_READY', 'الحساب غير جاهز للاستلام أو تغير ملف المنشأة.');
          if (
            account.phoneVerification.status !== 'VERIFIED' ||
            account.phoneVerification.phoneE164 !== order.profile.phoneE164 ||
            !account.phoneVerification.verifiedAt
          )
            fail('CUSTOMER_PHONE_NOT_VERIFIED', 'لم يكتمل تحقق WhatsApp للرقم الحالي.');
          if (!(await this.access.available(tx, account, order, true)))
            fail('CUSTOMER_DELIVERY_NOT_READY', 'الحساب غير متاح للاستلام.');
          status = 'DELIVERED';
        }
        const result = await this.store.save(tx, 'customer_orders', order, {
          status,
          open: !['DELIVERED', 'CANCELLED'].includes(status),
          ...(status === 'SUBMITTED' ? { profile: account.profile! } : {}),
          ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
          reason: data.reason ?? null,
        });
        return { result, orderId: id, reason: data.reason };
      },
    );
  }
  async review(userId: string, orderId: string, input: unknown) {
    const data = parse(
      z
        .object({
          ...command,
          rating: z.number().int().min(1).max(5),
          comment: z.string().trim().max(2000),
        })
        .strict(),
      input,
    );
    return this.store.command(
      userId,
      data.operationId,
      'customer.feedback',
      { orderId, ...data },
      async (tx) => {
        const account = await this.store.account(tx, userId);
        const order = await this.store.order(tx, orderId, account._id);
        if (order.status !== 'DELIVERED')
          fail('CUSTOMER_DELIVERY_REQUIRED', 'التقييم متاح بعد استلام الحساب فقط.');
        if (await collection(tx, 'customer_reviews').findOne({ orderId }, { session: tx.session }))
          fail('CUSTOMER_REVIEW_EXISTS', 'تم إرسال تقييم لهذا الطلب بالفعل.');
        const result = reviewSchema.parse({
          _id: randomUUID(),
          orderId,
          customerId: account._id,
          rating: data.rating,
          comment: data.comment,
          createdAt: new Date(),
        });
        await collection(tx, 'customer_reviews').insertOne(result, { session: tx.session });
        return { result, orderId };
      },
    );
  }
}
