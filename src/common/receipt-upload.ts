import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { BadRequestException } from '@nestjs/common';

export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

export interface ReceiptUpload {
  bytes: Buffer;
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sha256: string;
}

export interface ReceiptMultipartForm {
  receipt: ReceiptUpload;
  fields: Record<string, string>;
}

export class ReceiptUploadInvalidError extends BadRequestException {
  constructor() {
    super({
      code: 'PAYMENT_RECEIPT_INVALID',
      message: 'Receipt file or payment form is invalid',
    });
  }
}

export async function readReceiptMultipartForm(
  request: FastifyRequest,
): Promise<ReceiptMultipartForm> {
  if (!request.isMultipart()) throw new ReceiptUploadInvalidError();

  let receipt: ReceiptUpload | null = null;
  const fields: Record<string, string> = {};

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'receipt' || receipt) throw new ReceiptUploadInvalidError();
        const bytes = await part.toBuffer();
        if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES || part.file.truncated) {
          throw new ReceiptUploadInvalidError();
        }
        const mimeType = verifiedMimeType(part.mimetype, bytes);
        receipt = {
          bytes,
          fileName: safeFileName(part.filename),
          mimeType,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      } else {
        if (
          part.valueTruncated ||
          !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/u.test(part.fieldname) ||
          fields[part.fieldname] !== undefined
        ) {
          throw new ReceiptUploadInvalidError();
        }
        fields[part.fieldname] = String(part.value).trim();
      }
    }
  } catch (error) {
    if (error instanceof ReceiptUploadInvalidError) throw error;
    throw new ReceiptUploadInvalidError();
  }

  if (!receipt) throw new ReceiptUploadInvalidError();
  return { receipt, fields };
}

function verifiedMimeType(
  declared: string,
  bytes: Buffer,
): ReceiptUpload['mimeType'] {
  const pdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (pdf && declared === 'application/pdf') return 'application/pdf';
  if (png && declared === 'image/png') return 'image/png';
  if (jpeg && declared === 'image/jpeg') return 'image/jpeg';
  throw new ReceiptUploadInvalidError();
}

function safeFileName(value: string): string {
  const name = value
    .normalize('NFKC')
    .replace(/[/\\\u0000-\u001f\u007f"]/gu, '_')
    .trim()
    .slice(0, 120);
  return name || 'receipt';
}
