import { Injectable } from '@nestjs/common';
import { Binary } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ReceiptUpload } from '../common/receipt-upload';
import { fail } from '../internal-operations/operations.errors';
import { documentSchema, command, id, reason, version } from './journey.model';
import { JourneyStore, collection, expectVersion, parse, stored } from './journey.store';
function view(row: z.infer<typeof documentSchema>) {
  return stored(
    documentSchema.omit({ bytes: true }),
    Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'bytes')),
  );
}
@Injectable()
export class JourneyDocuments {
  constructor(readonly store: JourneyStore) {}
  async upload(userId: string, orderId: string, file: ReceiptUpload, input: unknown) {
    const data = parse(
      z
        .object({
          ...command,
          version: z.coerce.number().int().positive(),
          key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/u),
        })
        .strict(),
      input,
    );
    return this.store.command(
      userId,
      data.operationId,
      'customer.document.upload',
      { orderId, ...data, sha256: file.sha256, fileName: file.fileName, mimeType: file.mimeType },
      async (tx) => {
        const account = await this.store.account(tx, userId);
        const order = await this.store.order(tx, orderId, account._id);
        expectVersion(order.version, data.version);
        if (!['DRAFT', 'CHANGES_REQUESTED'].includes(order.status))
          fail(
            'CUSTOMER_UPLOAD_NOT_ALLOWED',
            'رفع الوثائق متاح في المسودة أو عند طلب التعديل فقط.',
          );
        if (!order.requirements.some((r) => r.key === data.key))
          fail('CUSTOMER_DOCUMENT_KIND_INVALID', 'نوع الوثيقة غير مطلوب في هذا الطلب.', 400);
        const count = await collection(tx, 'customer_documents').countDocuments(
          { customerId: account._id },
          { session: tx.session },
        );
        if (count >= 40)
          fail('CUSTOMER_DOCUMENT_LIMIT', 'بلغت حد الوثائق المحفوظة؛ راجع فريق ثنارة.');
        await collection(tx, 'customer_documents').updateMany(
          { orderId, key: data.key, superseded: false },
          { $set: { superseded: true }, $inc: { version: 1 } },
          { session: tx.session },
        );
        const row = documentSchema.parse({
          _id: randomUUID(),
          orderId,
          customerId: account._id,
          key: data.key,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sha256: file.sha256,
          bytes: new Binary(file.bytes),
          size: file.bytes.length,
          status: 'PENDING',
          reason: null,
          version: 1,
          superseded: false,
          uploadedAt: new Date(),
          reviewedAt: null,
          reviewedBy: null,
        });
        await collection(tx, 'customer_documents').insertOne(row, { session: tx.session });
        await this.store.save(tx, 'customer_orders', order, {});
        return { result: view(row), orderId };
      },
    );
  }
  async download(userId: string, documentId: string, admin = false) {
    parse(id, documentId);
    const read = async (
      tx: Parameters<JourneyStore['account']>[0],
      allowed: (orderId: string) => Promise<unknown>,
    ) => {
      const raw = await collection(tx, 'customer_documents').findOne(
        { _id: documentId },
        { session: tx.session },
      );
      if (!raw) fail('CUSTOMER_DOCUMENT_NOT_FOUND', 'الوثيقة غير متاحة.', 404);
      const doc = stored(documentSchema, raw);
      await allowed(doc.orderId);
      return {
        bytes: Buffer.from(doc.bytes.buffer),
        fileName: doc.fileName,
        mimeType: doc.mimeType,
      };
    };
    if (admin)
      return this.store.company.read(userId, 'customers.read', (w) =>
        read(w, (orderId) => this.store.adminOrder(w, orderId)),
      );
    return this.store.run(async (tx) => {
      const account = await this.store.account(tx, userId);
      return read(tx, (orderId) => this.store.order(tx, orderId, account._id));
    });
  }
  async review(userId: string, documentId: string, input: unknown) {
    const data = parse(
      z
        .object({
          ...command,
          version,
          decision: z.enum(['APPROVED', 'REJECTED']),
          reason,
        })
        .strict(),
      input,
    );
    return this.store.adminCommand(
      userId,
      data.operationId,
      'customer.document.review',
      { documentId, ...data },
      'customers.review',
      async (w) => {
        const raw = await collection(w, 'customer_documents').findOne(
          { _id: documentId },
          { session: w.session },
        );
        if (!raw) fail('CUSTOMER_DOCUMENT_NOT_FOUND', 'الوثيقة غير متاحة.', 404);
        const doc = stored(documentSchema, raw);
        const order = await this.store.adminOrder(w, doc.orderId);
        expectVersion(doc.version, data.version);
        if (doc.superseded || order.status !== 'SUBMITTED')
          fail('CUSTOMER_DOCUMENT_REVIEW_INVALID', 'الوثيقة أو الطلب ليسا متاحين للمراجعة.');
        const account = await collection(w, 'customer_accounts').findOne(
          { _id: order.customerId },
          { session: w.session },
        );
        if (account?.userId === userId)
          fail('CUSTOMER_INDEPENDENT_REVIEW_REQUIRED', 'لا يجوز مراجعة وثائق طلبك الشخصي.');
        const updated = {
          ...doc,
          status: data.decision,
          reason: data.reason,
          version: doc.version + 1,
          reviewedBy: userId,
          reviewedAt: new Date(),
        };
        await collection(w, 'customer_documents').replaceOne(
          { _id: documentId, version: doc.version },
          updated,
          { session: w.session },
        );
        return {
          result: view(updated),
          orderId: order._id,
          fromVersion: doc.version,
          toVersion: updated.version,
        };
      },
    );
  }
}
