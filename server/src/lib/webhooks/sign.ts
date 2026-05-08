import crypto from 'node:crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'X-Alga-Signature';

interface ParsedWebhookSignature {
  timestamp: string;
  signature: string;
}

function buildSignedPayload(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

function computeSignature(secret: string, body: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(buildSignedPayload(timestamp, body), 'utf8')
    .digest('hex');
}

export function signRequest(
  secret: string,
  body: string,
  timestamp: number | string,
): string {
  const normalizedTimestamp = String(timestamp);
  const signature = computeSignature(secret, body, normalizedTimestamp);
  return `t=${normalizedTimestamp},v1=${signature}`;
}

export function parseWebhookSignature(
  signatureHeader: string,
): ParsedWebhookSignature | null {
  const parts = signatureHeader.split(',').map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith('t='))?.slice(2);
  const signature = parts.find((part) => part.startsWith('v1='))?.slice(3);

  if (!timestamp || !signature) {
    return null;
  }

  return { timestamp, signature };
}

export function verifyWebhookSignature(
  signatureHeader: string,
  body: string,
  secret: string,
): boolean {
  const parsed = parseWebhookSignature(signatureHeader);
  if (!parsed) {
    return false;
  }

  const expectedSignature = computeSignature(secret, body, parsed.timestamp);
  const providedBuffer = Buffer.from(parsed.signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

