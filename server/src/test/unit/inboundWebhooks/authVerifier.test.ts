import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getTenantSecret = vi.fn();

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: (...args: unknown[]) => getTenantSecret(...args),
  })),
}));

function hmacSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function mutateHexSignature(signature: string): string {
  const replacement = signature[0] === '0' ? '1' : '0';
  return `${replacement}${signature.slice(1)}`;
}

describe('inbound webhook auth verifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTenantSecret.mockResolvedValue('top-secret');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T042: HMAC verification uses timing-safe comparison for byte mismatches', async () => {
    const body = JSON.stringify({ alert: { id: 'alert-1' } });
    const validSignature = hmacSignature('top-secret', body);
    const invalidSameLengthSignature = mutateHexSignature(validSignature);
    const timingSafeEqual = vi.spyOn(crypto, 'timingSafeEqual');

    const { verifyInboundWebhookAuth } = await import('@/lib/inboundWebhooks/authVerifier');
    const result = await verifyInboundWebhookAuth({
      tenant: 'tenant-a',
      authType: 'hmac_sha256',
      authConfig: {
        signature_header: 'X-Signature',
        secret_vault_path: 'inbound-webhooks/inbound_webhook_webhook-1_hmac_secret',
      },
      headers: new Headers({
        'X-Signature': `sha256=${invalidSameLengthSignature}`,
      }),
      rawBody: body,
      sourceIp: null,
      url: new URL('http://localhost/api/inbound/tenant-slug/rmm-alerts'),
    });

    expect(result).toEqual({ verified: false, authStatus: 'rejected_signature' });
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    expect(timingSafeEqual.mock.calls[0][0]).toHaveLength(validSignature.length);
    expect(timingSafeEqual.mock.calls[0][1]).toHaveLength(validSignature.length);
  });

  it('T043: Bearer verification uses timing-safe comparison for token mismatches', async () => {
    getTenantSecret.mockResolvedValue('bearer-secret');
    const invalidSameLengthToken = 'cearer-secret';
    const timingSafeEqual = vi.spyOn(crypto, 'timingSafeEqual');

    const { verifyInboundWebhookAuth } = await import('@/lib/inboundWebhooks/authVerifier');
    const result = await verifyInboundWebhookAuth({
      tenant: 'tenant-a',
      authType: 'bearer',
      authConfig: {
        token_vault_path: 'inbound-webhooks/inbound_webhook_webhook-1_bearer_token',
      },
      headers: new Headers({
        authorization: `Bearer ${invalidSameLengthToken}`,
      }),
      rawBody: '',
      sourceIp: null,
      url: new URL('http://localhost/api/inbound/tenant-slug/billing-events'),
    });

    expect(result).toEqual({ verified: false, authStatus: 'rejected_bearer' });
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    expect(timingSafeEqual.mock.calls[0][0]).toHaveLength('bearer-secret'.length);
    expect(timingSafeEqual.mock.calls[0][1]).toHaveLength('bearer-secret'.length);
  });
});
