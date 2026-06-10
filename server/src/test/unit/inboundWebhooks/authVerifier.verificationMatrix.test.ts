import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTenantSecret = vi.fn();

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: (...args: unknown[]) => getTenantSecret(...args),
  })),
}));

import { verifyInboundWebhookAuth, timingSafeCompare } from '@/lib/inboundWebhooks/authVerifier';

const URL_BASE = 'http://localhost/api/inbound/tenant-slug/hook';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-a',
    authType: 'hmac_sha256',
    authConfig: {},
    headers: new Headers(),
    rawBody: '',
    sourceIp: null,
    url: new URL(URL_BASE),
    ...overrides,
  } as any;
}

describe('inbound webhook auth verifier coverage matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTenantSecret.mockResolvedValue('top-secret');
  });

  describe('hmac_sha256', () => {
    it('should verify a valid signature using the default X-Alga-Signature header', async () => {
      const body = JSON.stringify({ event: 'created' });
      const signature = crypto.createHmac('sha256', 'top-secret').update(body).digest('hex');

      const result = await verifyInboundWebhookAuth(baseInput({
        authConfig: { secret_vault_path: 'inbound-webhooks/hook_hmac_secret' },
        headers: new Headers({ 'X-Alga-Signature': signature }),
        rawBody: body,
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
      // The vault path is reduced to its last segment when reading the tenant secret.
      expect(getTenantSecret).toHaveBeenCalledWith('tenant-a', 'hook_hmac_secret');
    });

    it('should accept signatures carrying the sha256= prefix', async () => {
      const body = '{"a":1}';
      const signature = crypto.createHmac('sha256', 'top-secret').update(body).digest('hex');

      const result = await verifyInboundWebhookAuth(baseInput({
        authConfig: { secret_vault_path: 'vault/secret-path' },
        headers: new Headers({ 'X-Alga-Signature': `sha256=${signature}` }),
        rawBody: body,
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
    });

    it('should reject when the signature header is absent', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authConfig: { secret_vault_path: 'vault/secret-path' },
        rawBody: '{}',
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_signature' });
    });

    it('should reject when no secret vault path is configured', async () => {
      const body = '{}';
      const signature = crypto.createHmac('sha256', 'top-secret').update(body).digest('hex');

      const result = await verifyInboundWebhookAuth(baseInput({
        authConfig: {},
        headers: new Headers({ 'X-Alga-Signature': signature }),
        rawBody: body,
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_signature' });
      expect(getTenantSecret).not.toHaveBeenCalled();
    });
  });

  describe('bearer', () => {
    it('should verify a matching bearer token case-insensitively on the scheme', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'bearer',
        authConfig: { token_vault_path: 'vault/bearer-token' },
        headers: new Headers({ authorization: 'BEARER top-secret' }),
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
    });

    it('should reject a non-bearer authorization header', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'bearer',
        authConfig: { token_vault_path: 'vault/bearer-token' },
        headers: new Headers({ authorization: 'Basic dXNlcjpwYXNz' }),
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_bearer' });
    });
  });

  describe('ip_allowlist', () => {
    it('should verify an exact IP match without a CIDR prefix', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'ip_allowlist',
        authConfig: { ip_cidrs: ['203.0.113.10'] },
        sourceIp: '203.0.113.10',
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
    });

    it('should verify an IP inside a configured CIDR range', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'ip_allowlist',
        authConfig: { ip_cidrs: ['10.1.0.0/16'] },
        sourceIp: '10.1.42.7',
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
    });

    it('should reject an IP outside every configured CIDR range', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'ip_allowlist',
        authConfig: { ip_cidrs: ['10.1.0.0/16', '192.168.0.0/24'] },
        sourceIp: '10.2.0.1',
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_ip' });
    });

    it('should reject when the source IP is unknown', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'ip_allowlist',
        authConfig: { ip_cidrs: ['0.0.0.0/0'] },
        sourceIp: null,
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_ip' });
    });

    it('should reject when the allowlist is empty', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'ip_allowlist',
        authConfig: {},
        sourceIp: '10.0.0.1',
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_ip' });
    });

    it('should reject malformed CIDR entries instead of allowing them', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'ip_allowlist',
        authConfig: { ip_cidrs: ['not-a-cidr/99'] },
        sourceIp: '10.0.0.1',
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_ip' });
    });

    it('should support the camelCase ipCidrs config variant', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'ip_allowlist',
        authConfig: { ipCidrs: ['198.51.100.0/24'] },
        sourceIp: '198.51.100.200',
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
    });
  });

  describe('path_token', () => {
    it('should verify a matching token from the configured query parameter', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'path_token',
        authConfig: { query_param: 'key', token_vault_path: 'vault/path-token' },
        url: new URL(`${URL_BASE}?key=top-secret`),
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
    });

    it('should default to the token query parameter', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'path_token',
        authConfig: { token_vault_path: 'vault/path-token' },
        url: new URL(`${URL_BASE}?token=top-secret`),
      }));

      expect(result).toEqual({ verified: true, authStatus: 'verified' });
    });

    it('should reject a mismatched token', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'path_token',
        authConfig: { token_vault_path: 'vault/path-token' },
        url: new URL(`${URL_BASE}?token=wrong-secret`),
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_no_auth' });
    });

    it('should reject when the token parameter is missing', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'path_token',
        authConfig: { token_vault_path: 'vault/path-token' },
        url: new URL(URL_BASE),
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_no_auth' });
    });
  });

  describe('unknown auth types', () => {
    it('should reject unsupported auth types without consulting secrets', async () => {
      const result = await verifyInboundWebhookAuth(baseInput({
        authType: 'magic_link',
      }));

      expect(result).toEqual({ verified: false, authStatus: 'rejected_no_auth' });
      expect(getTenantSecret).not.toHaveBeenCalled();
    });
  });

  describe('timingSafeCompare', () => {
    it('should return true only for exact matches', () => {
      expect(timingSafeCompare('abc', 'abc')).toBe(true);
      expect(timingSafeCompare('abc', 'abd')).toBe(false);
    });

    it('should return false for different-length values instead of throwing', () => {
      expect(timingSafeCompare('short', 'a-much-longer-value')).toBe(false);
      expect(timingSafeCompare('', '')).toBe(true);
    });
  });
});
