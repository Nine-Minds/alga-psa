/**
 * Durable, stateless, signed token for the public `/pay/<token>` invoice link.
 *
 * Stripe Checkout Sessions last at most 24h, so invoice emails carry this token
 * instead of `session.url`. Each click mints (or reuses) a fresh Checkout
 * Session while the invoice is payable. The token's lifetime is the tenant's
 * `paymentLinkExpirationHours` (1-720).
 *
 * Lives in packages/billing (not ee/server) so the email context can issue it
 * and the public route can verify it without crossing the EE package boundary.
 *
 * Construction mirrors ee/server/src/lib/payments/publicSetupConfirmation.ts:
 * AES-256-GCM keyed from NEXTAUTH_SECRET via scrypt with a dedicated salt, so a
 * token from one feature can never decrypt in another.
 *
 * The token carries NO amount. The balance is always recomputed on the server.
 * Verification fails closed: any malformed, tampered, wrong-key, or expired
 * input yields `{ ok: false }`; it never throws.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import {
  PAYMENT_LINK_EXPIRATION_MAX_HOURS,
  PAYMENT_LINK_EXPIRATION_MIN_HOURS,
} from '@alga-psa/types';

export const PAYMENT_LINK_TOKEN_SALT = 'invoice-payment-link-token';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const TOKEN_VERSION = 1;
/** Upper bound on token text length, checked before any decoding work. */
const MAX_TOKEN_CHARS = 512;

export interface PaymentLinkTokenPayload {
  tenantId: string;
  invoiceId: string;
  /** Expiry as epoch milliseconds. */
  exp: number;
}

export type PaymentLinkTokenVerification =
  | ({ ok: true } & PaymentLinkTokenPayload)
  | { ok: false; reason: 'invalid' | 'expired' };

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for invoice payment link tokens');
  return scryptSync(secret, PAYMENT_LINK_TOKEN_SALT, 32);
}

export function issuePaymentLinkToken(
  params: { tenantId: string; invoiceId: string; lifetimeHours: number },
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  const { tenantId, invoiceId, lifetimeHours } = params;
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(invoiceId)) {
    throw new Error('Invalid tenant or invoice id for payment link token');
  }
  if (
    !Number.isInteger(lifetimeHours) ||
    lifetimeHours < PAYMENT_LINK_EXPIRATION_MIN_HOURS ||
    lifetimeHours > PAYMENT_LINK_EXPIRATION_MAX_HOURS
  ) {
    throw new Error('Invalid payment link lifetime');
  }

  const exp = now.getTime() + lifetimeHours * 60 * 60 * 1000;
  const body = JSON.stringify({ v: TOKEN_VERSION, t: tenantId, i: invoiceId, e: exp });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  return { token, expiresAt: new Date(exp) };
}

export function verifyPaymentLinkToken(
  token: unknown,
  now: Date = new Date(),
): PaymentLinkTokenVerification {
  try {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
      return { ok: false, reason: 'invalid' };
    }
    if (!/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: 'invalid' };

    const bytes = Buffer.from(token, 'base64url');
    if (bytes.length <= IV_BYTES + TAG_BYTES) return { ok: false, reason: 'invalid' };

    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const encrypted = bytes.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const data = JSON.parse(plain) as { v?: unknown; t?: unknown; i?: unknown; e?: unknown };

    if (
      data.v !== TOKEN_VERSION ||
      typeof data.t !== 'string' || !UUID_RE.test(data.t) ||
      typeof data.i !== 'string' || !UUID_RE.test(data.i) ||
      typeof data.e !== 'number' || !Number.isFinite(data.e)
    ) {
      return { ok: false, reason: 'invalid' };
    }

    if (data.e <= now.getTime()) return { ok: false, reason: 'expired' };

    return { ok: true, tenantId: data.t, invoiceId: data.i, exp: data.e };
  } catch {
    // Wrong key, tampering, truncation, bad JSON, missing secret: all fail closed.
    return { ok: false, reason: 'invalid' };
  }
}
