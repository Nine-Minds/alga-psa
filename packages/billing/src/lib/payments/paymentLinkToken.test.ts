import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { issuePaymentLinkToken, verifyPaymentLinkToken, PAYMENT_LINK_TOKEN_SALT } from './paymentLinkToken';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INVOICE = '22222222-2222-4222-8222-222222222222';
const HOUR = 3600_000;
const NOW = new Date('2026-10-01T00:00:00Z');

describe('paymentLinkToken', () => {
  const original = process.env.NEXTAUTH_SECRET;
  beforeEach(() => { process.env.NEXTAUTH_SECRET = 'secret-one'; });
  afterEach(() => { process.env.NEXTAUTH_SECRET = original; });

  it('round-trips tenant, invoice and an expiry of issue time + lifetime', () => {
    const { token, expiresAt } = issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: 720 }, NOW);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 720 * HOUR);
    const result = verifyPaymentLinkToken(token, new Date(NOW.getTime() + 719 * HOUR));
    expect(result).toEqual({ ok: true, tenantId: TENANT, invoiceId: INVOICE, exp: NOW.getTime() + 720 * HOUR });
  });

  it('carries no amount and does not expose ids in plaintext', () => {
    const { token } = issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: 24 }, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(TENANT);
    expect(Buffer.from(token, 'base64url').toString('utf8')).not.toContain(INVOICE);
  });

  it('rejects an expired token', () => {
    const { token } = issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: 24 }, NOW);
    expect(verifyPaymentLinkToken(token, new Date(NOW.getTime() + 24 * HOUR))).toEqual({ ok: false, reason: 'expired' });
    expect(verifyPaymentLinkToken(token, new Date(NOW.getTime() + 25 * HOUR))).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects tampering anywhere in the token', () => {
    const { token } = issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: 24 }, NOW);
    const bytes = Buffer.from(token, 'base64url');
    for (const i of [0, 12, 20, bytes.length - 1]) {
      const copy = Buffer.from(bytes);
      copy[i] ^= 0x01;
      expect(verifyPaymentLinkToken(copy.toString('base64url'), NOW)).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(verifyPaymentLinkToken(token.slice(0, -4), NOW).ok).toBe(false);
    expect(verifyPaymentLinkToken(token + 'AAAA', NOW).ok).toBe(false);
  });

  it('rejects a token verified under a different key', () => {
    const { token } = issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: 24 }, NOW);
    process.env.NEXTAUTH_SECRET = 'secret-two';
    expect(verifyPaymentLinkToken(token, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('fails closed when the secret is missing (verify) and refuses to issue', () => {
    const { token } = issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: 24 }, NOW);
    delete process.env.NEXTAUTH_SECRET;
    expect(verifyPaymentLinkToken(token, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(() => issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: 24 })).toThrow();
  });

  it('rejects garbage input without throwing', () => {
    for (const bad of [undefined, null, 42, '', 'not-a-token', '%%%', 'A'.repeat(600), {}]) {
      expect(verifyPaymentLinkToken(bad as unknown, NOW)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('refuses to issue for non-UUID ids or out-of-range lifetimes', () => {
    expect(() => issuePaymentLinkToken({ tenantId: 'tenant', invoiceId: INVOICE, lifetimeHours: 24 })).toThrow();
    expect(() => issuePaymentLinkToken({ tenantId: TENANT, invoiceId: 'x', lifetimeHours: 24 })).toThrow();
    for (const hours of [0, 721, 1.5, NaN]) {
      expect(() => issuePaymentLinkToken({ tenantId: TENANT, invoiceId: INVOICE, lifetimeHours: hours })).toThrow();
    }
  });

  it('rejects a correctly keyed token whose payload ids are not UUIDs', () => {
    const key = scryptSync('secret-one', PAYMENT_LINK_TOKEN_SALT, 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const body = JSON.stringify({ v: 1, t: 'tenant-a', i: INVOICE, e: NOW.getTime() + HOUR });
    const enc = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
    const forged = Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
    expect(verifyPaymentLinkToken(forged, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });
});
