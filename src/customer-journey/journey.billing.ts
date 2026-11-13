import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail } from '../internal-operations/operations.errors';
import { mongoSubscriptionTransferSchema } from '../platform-mongo/mongo-subscription-payment.service';
import { command, id, invoiceSchema, minor, reason, version } from './journey.model';
import { JourneyStore, collection, expectVersion, parse, stored } from './journey.store';
@Injectable()
export class JourneyBilling {
  constructor(readonly store: JourneyStore) {}
  async create(userId: string, orderId: string, input: unknown) {
    const data = parse(
      z
        .object({
          ...command,
          subtotalMinor: minor,
          taxMinor: minor,
          description: z.string().trim().min(3).max(500),
          dueDate: z.iso.date(),
        })
        .strict(),
      input,
    );
    const totalMinor = (BigInt(data.subtotalMinor) + BigInt(data.taxMinor)).toString();
    parse(minor, totalMinor);
    if (BigInt(totalMinor) <= 0n)
      fail('CUSTOMER_INVOICE_AMOUNT_INVALID', 'يلزم إجمالي موجب للفاتورة.', 400);
    return this.store.adminCommand(
      userId,
      data.operationId,
      'customer.invoice.create',
      { orderId, ...data },
      'finance.manage',
      async (w) => {
        this.store.company.require(w.actor, 'customers.read');
        const order = await this.store.adminOrder(w, orderId);
        if (!['SUBMITTED', 'APPROVED', 'ACTIVE', 'DELIVERED'].includes(order.status))
          fail('CUSTOMER_INVOICE_NOT_ALLOWED', 'حالة الطلب لا تسمح بإنشاء مسودة فاتورة.');
        if (
          await collection(w, 'customer_invoices').findOne(
            { orderId, status: { $ne: 'VOID' } },
            { session: w.session },
          )
        )
          fail('CUSTOMER_INVOICE_EXISTS', 'توجد فاتورة غير ملغاة لهذا الطلب.');
        const now = new Date();
        const result = invoiceSchema.parse({
          _id: randomUUID(),
          orderId,
          customerId: order.customerId,
          tenantId: order.tenantId,
          subscriptionId: order.subscriptionId,
          version: 1,
          status: 'DRAFT',
          number: null,
          subtotalMinor: data.subtotalMinor,
          taxMinor: data.taxMinor,
          totalMinor,
          currency: 'SAR',
          description: data.description,
          dueDate: data.dueDate,
          seller: null,
          createdBy: userId,
          issuedBy: null,
          transferId: null,
          issuedAt: null,
          createdAt: now,
          updatedAt: now,
        });
        await collection(w, 'customer_invoices').insertOne(result, { session: w.session });
        return { result, orderId, toVersion: 1 };
      },
    );
  }
  async action(userId: string, invoiceId: string, input: unknown) {
    const data = parse(
      z
        .object({
          ...command,
          version,
          action: z.enum(['issue', 'void', 'link_payment']),
          reason,
          transferId: id.optional(),
        })
        .strict(),
      input,
    );
    return this.store.adminCommand(
      userId,
      data.operationId,
      `customer.invoice.${data.action}`,
      { invoiceId, ...data },
      'finance.post',
      async (w) => {
        this.store.company.require(w.actor, 'customers.read');
        const raw = await collection(w, 'customer_invoices').findOne(
          { _id: invoiceId },
          { session: w.session },
        );
        if (!raw) fail('CUSTOMER_INVOICE_NOT_FOUND', 'الفاتورة غير متاحة.', 404);
        const invoice = stored(invoiceSchema, raw);
        const order = await this.store.adminOrder(w, invoice.orderId);
        expectVersion(invoice.version, data.version);
        let changes: Partial<z.infer<typeof invoiceSchema>>;
        if (data.action === 'issue') {
          if (
            invoice.status !== 'DRAFT' ||
            !['ACTIVE', 'DELIVERED'].includes(order.status) ||
            !order.tenantId ||
            !order.subscriptionId
          )
            fail(
              'CUSTOMER_INVOICE_ISSUE_BLOCKED',
              'إصدار الفاتورة يحتاج مسودة واشتراكًا مربوطًا بحساب مفعّل.',
            );
          if (invoice.createdBy === userId)
            fail(
              'CUSTOMER_INDEPENDENT_REVIEW_REQUIRED',
              'إصدار الفاتورة يحتاج مراجعًا مختلفًا عن منشئها.',
            );
          const catalog = await this.store.catalog(w);
          if (!catalog.live?.seller || !catalog.publishedBy || !catalog.publishedAt)
            fail(
              'CUSTOMER_INVOICE_POLICY_REQUIRED',
              'يلزم اعتماد بيانات البائع وسياسة الترقيم أولًا.',
            );
          const seller = catalog.live.seller,
            now = new Date();
          const counterId = `${seller.prefix}-${now.getUTCFullYear()}`;
          const counter = await collection(w, 'customer_counters').findOneAndUpdate(
            { _id: counterId },
            { $inc: { value: 1 } },
            { session: w.session, upsert: true, returnDocument: 'after' },
          );
          if (!counter || !Number.isSafeInteger(counter.value) || counter.value < 1)
            fail('CUSTOMER_INVOICE_SEQUENCE_INVALID', 'تعذر تخصيص رقم فاتورة بأمان.', 503);
          changes = {
            status: 'ISSUED',
            number: `${counterId}-${String(counter.value).padStart(6, '0')}`,
            seller,
            issuedBy: userId,
            issuedAt: now,
            tenantId: order.tenantId,
            subscriptionId: order.subscriptionId,
          };
        } else if (data.action === 'void') {
          if (!['DRAFT', 'ISSUED'].includes(invoice.status))
            fail(
              'CUSTOMER_INVOICE_VOID_BLOCKED',
              'لا يجوز إلغاء فاتورة مدفوعة أو ملغاة بهذا المسار.',
            );
          changes = { status: 'VOID' };
        } else {
          if (
            invoice.status !== 'ISSUED' ||
            !data.transferId ||
            !invoice.subscriptionId ||
            !invoice.tenantId
          )
            fail('CUSTOMER_INVOICE_PAYMENT_INVALID', 'يلزم رقم تحويل معتمد لفاتورة صادرة.');
          const transferRaw = await collection(w, 'subscription_transfers').findOne(
            { _id: data.transferId },
            { session: w.session },
          );
          if (!transferRaw) fail('CUSTOMER_INVOICE_PAYMENT_INVALID', 'التحويل غير متاح.');
          const transfer = stored(mongoSubscriptionTransferSchema, transferRaw);
          if (
            transfer.status !== 'APPROVED' ||
            !transfer.reviewedBy ||
            !transfer.reviewedAt ||
            !transfer.reviewReason ||
            transfer.subscriptionId !== invoice.subscriptionId ||
            transfer.tenantId !== invoice.tenantId ||
            transfer.currencyCode !== invoice.currency ||
            transfer.amountMinor !== invoice.totalMinor
          )
            fail(
              'CUSTOMER_INVOICE_PAYMENT_MISMATCH',
              'التحويل يجب أن يكون معتمدًا ومطابقًا للاشتراك والمبلغ والعملة.',
            );
          const prior = await collection(w, 'customer_invoices').findOne(
            { transferId: transfer._id },
            { session: w.session },
          );
          if (prior) fail('CUSTOMER_TRANSFER_ALREADY_LINKED', 'هذا التحويل مرتبط بفاتورة أخرى.');
          changes = { status: 'PAID', transferId: transfer._id };
        }
        const result = await this.store.save(w, 'customer_invoices', invoice, changes);
        return {
          result,
          orderId: order._id,
          fromVersion: invoice.version,
          toVersion: result.version,
        };
      },
    );
  }
}
