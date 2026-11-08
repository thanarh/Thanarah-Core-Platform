import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies an HMAC-SHA256 webhook signature over the exact received bytes.
 * The expected format is "sha256=<hex digest>".
 */
export function verifyHmacSha256WebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
  const match = /^sha256=([a-f0-9]{64})$/iu.exec(signature.trim());
  if (!match?.[1]) return false;

  const actual = Buffer.from(match[1], 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
