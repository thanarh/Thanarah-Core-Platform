import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { z } from 'zod';
import { PlatformMongoClientManager } from '../platform-mongo/platform-mongo.client.manager';
import { JourneyStore } from './journey.store';
import { id, packageCode } from './journey.model';

/** Business inquiries only. No patient records, authentication, or provider side effects. */
export const inquiryInputSchema = z
  .object({
    operationId: id,
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254).toLowerCase(),
    organization: z.string().trim().min(2).max(191),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/u)
      .optional(),
    topic: z.enum([
      'general',
      'clinic',
      'website',
      'integrations',
      'ai',
      'communications',
      'technical',
    ]),
    packageCode: packageCode.optional(),
    message: z.string().trim().min(10).max(3000),
    consent: z.literal(true),
    website: z.literal(''),
    locale: z.enum(['ar', 'en']),
  })
  .strict();

const inquiryPayloadSchema = inquiryInputSchema.omit({ operationId: true, website: true });
const inquiryRecordSchema = z
  .object({
    _id: id,
    reference: z.string(),
    fingerprint: z.string(),
    payload: inquiryPayloadSchema,
    status: z.literal('NEW'),
    createdAt: z.date(),
  })
  .strict();

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'INQUIRY_STORAGE_UNAVAILABLE',
    message: 'تعذر تأكيد حفظ الاستفسار. احتفظ بالطلب وأعد المحاولة بنفس المرجع.',
  });
}

@Injectable()
export class JourneyInquiries {
  constructor(
    readonly manager: PlatformMongoClientManager,
    readonly store: JourneyStore,
  ) {}

  async create(input: unknown): Promise<{ reference: string; receivedAt: string }> {
    const checked = inquiryInputSchema.safeParse(input);
    if (!checked.success)
      throw new BadRequestException({
        code: 'INQUIRY_INPUT_INVALID',
        message: 'تحقق من الحقول والموافقة، ولا تضع بيانات مرضى في الاستفسار.',
      });
    const { operationId } = checked.data;
    const payload = inquiryPayloadSchema.strip().parse(checked.data);
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const candidate = {
      _id: operationId,
      reference: `TH-${operationId.toUpperCase()}`,
      fingerprint,
      payload,
      status: 'NEW' as const,
      createdAt: new Date(),
    };
    let raw: unknown;
    try {
      const db = await this.manager.getDatabase();
      // MongoDB's built-in unique _id index gives atomic deduplication, including
      // after an uncertain write. No startup migration or secondary database.
      const inquiries = db.collection<{ _id: string }>('customer_inquiries');
      try {
        raw = await inquiries.findOneAndUpdate(
          { _id: operationId },
          { $setOnInsert: candidate },
          { upsert: true, returnDocument: 'after', writeConcern: { w: 'majority' } },
        );
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
        raw = await inquiries.findOne({ _id: operationId });
      }
    } catch {
      throw unavailable();
    }
    const stored = inquiryRecordSchema.safeParse(raw);
    if (!stored.success) throw unavailable();
    if (stored.data.fingerprint !== fingerprint)
      throw new ConflictException({
        code: 'INQUIRY_REFERENCE_CONFLICT',
        message: 'استُخدم مرجع الاستفسار لبيانات مختلفة. لا تعدل طلبًا لم تتأكد نتيجته.',
      });
    return {
      reference: stored.data.reference,
      receivedAt: stored.data.createdAt.toISOString(),
    };
  }

  async list(userId: string): Promise<{
    items: Array<z.infer<typeof inquiryPayloadSchema> & { reference: string; receivedAt: string }>;
    limit: number;
  }> {
    // Public callers and tenant members cannot read leads. Reuse the existing
    // central authorization snapshot; only company-wide customer managers.
    return this.store.company.read(userId, 'customers.manage_all', async (work) => {
      const rows = await work.db
        .collection('customer_inquiries')
        .find({}, { session: work.session })
        .sort({ createdAt: -1, _id: -1 })
        .limit(50)
        .toArray();
      return {
        items: rows.map((row) => {
          const record = inquiryRecordSchema.safeParse(row);
          if (!record.success) throw unavailable();
          return {
            ...record.data.payload,
            reference: record.data.reference,
            receivedAt: record.data.createdAt.toISOString(),
          };
        }),
        limit: 50,
      };
    });
  }
}
