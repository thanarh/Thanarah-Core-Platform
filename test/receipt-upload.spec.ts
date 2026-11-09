import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  MAX_RECEIPT_BYTES,
  ReceiptUploadInvalidError,
  readReceiptMultipartForm,
} from '../src/common/receipt-upload';

function requestWithParts(parts: unknown[]) {
  return {
    isMultipart: () => true,
    parts: async function* () {
      for (const part of parts) yield part;
    },
  } as unknown as FastifyRequest;
}

function filePart(
  bytes: Buffer,
  options: { fileName?: string; mimeType?: string; truncated?: boolean } = {},
) {
  return {
    type: 'file',
    fieldname: 'receipt',
    filename: options.fileName ?? 'receipt.pdf',
    mimetype: options.mimeType ?? 'application/pdf',
    file: { truncated: options.truncated ?? false },
    toBuffer: async () => bytes,
  };
}

describe('receipt upload validation', () => {
  it('accepts a supported signature and returns a sanitized filename and digest', async () => {
    const bytes = Buffer.from('%PDF-1.4\nreceipt');
    const result = await readReceiptMultipartForm(
      requestWithParts([filePart(bytes, { fileName: '../private/receipt.pdf' })]),
    );

    expect(result.receipt).toMatchObject({
      fileName: '.._private_receipt.pdf',
      mimeType: 'application/pdf',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('rejects a MIME mismatch, truncated file, duplicate receipt, and oversized file', async () => {
    await expect(
      readReceiptMultipartForm(
        requestWithParts([filePart(Buffer.from('%PDF-1.4\nbad'), { mimeType: 'image/png' })]),
      ),
    ).rejects.toBeInstanceOf(ReceiptUploadInvalidError);
    await expect(
      readReceiptMultipartForm(
        requestWithParts([filePart(Buffer.from('%PDF-1.4\ncut'), { truncated: true })]),
      ),
    ).rejects.toBeInstanceOf(ReceiptUploadInvalidError);
    await expect(
      readReceiptMultipartForm(
        requestWithParts([
          filePart(Buffer.from('%PDF-1.4\none')),
          filePart(Buffer.from('%PDF-1.4\ntwo')),
        ]),
      ),
    ).rejects.toBeInstanceOf(ReceiptUploadInvalidError);
    await expect(
      readReceiptMultipartForm(
        requestWithParts([filePart(Buffer.alloc(MAX_RECEIPT_BYTES + 1, 65))]),
      ),
    ).rejects.toBeInstanceOf(ReceiptUploadInvalidError);
  });
});
