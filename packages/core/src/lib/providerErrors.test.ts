import { afterEach, describe, expect, it, vi } from 'vitest';

import { sanitizeLogMeta, sanitizeProviderMessage, toSafeProviderError } from './providerErrors';

const SENTINELS = {
  accessToken: 'SENTINEL-ACCESS-TOKEN-9f8e7d6c5b4a39281706f5e4d3c2b1a0aabbccdd',
  refreshToken: 'SENTINEL-REFRESH-TOKEN-0a1b2c3d4e5f60718293a4b5c6d7e8f9deadbeef',
  clientSecret: 'SENTINEL-CLIENT-SECRET-abcdef0123456789abcdef0123456789cafebabe',
  authHeader: 'Bearer SENTINEL-AUTH-HEADER-fedcba9876543210fedcba9876543210feedface',
  customerName: 'SENTINEL Customer Acme Ltd',
  invoiceDetail: 'SENTINEL Invoice INV-4242 for 12 widgets'
};

function expectNoSentinels(serialized: string): void {
  for (const sentinel of Object.values(SENTINELS)) {
    expect(serialized).not.toContain(sentinel);
  }
}

function makeAxiosError(data: unknown, status = 400): Record<string, unknown> {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    config: {
      headers: { Authorization: SENTINELS.authHeader },
      data: `grant_type=refresh_token&refresh_token=${SENTINELS.refreshToken}&client_secret=${SENTINELS.clientSecret}`
    },
    response: {
      status,
      headers: { intuit_tid: 'tid-123' },
      data
    }
  };
}

describe('toSafeProviderError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps allowlisted diagnostics and drops the full provider body', () => {
    const error = makeAxiosError({
      Fault: {
        Error: [
          {
            code: '6240',
            Message: 'Duplicate Name Exists Error',
            Detail: `A customer named ${SENTINELS.customerName} already exists`
          }
        ]
      },
      access_token: SENTINELS.accessToken
    });

    const safe = toSafeProviderError('qbo', error, { operation: 'createCustomer' });

    expect(safe.provider).toBe('qbo');
    expect(safe.operation).toBe('createCustomer');
    expect(safe.status).toBe(400);
    expect(safe.providerErrorCode).toBe('6240');
    expect(safe.correlationId).toBe('tid-123');
    expect(safe.message).toContain('Duplicate Name Exists');
    expectNoSentinels(JSON.stringify(safe));
  });

  it('treats malformed token-exchange responses as sensitive', () => {
    const error = makeAxiosError(
      {
        // Provider misbehaved: token fields present but expected shape absent
        access_token: SENTINELS.accessToken,
        refresh_token: SENTINELS.refreshToken,
        unexpected: SENTINELS.invoiceDetail
      },
      200
    );

    const safe = toSafeProviderError('xero', error, { operation: 'tokenExchange' });
    expectNoSentinels(JSON.stringify(safe));
    expect(safe.status).toBe(200);
    expect(typeof safe.message).toBe('string');
  });

  it('extracts OAuth error codes without keeping the body', () => {
    const error = makeAxiosError({
      error: 'invalid_grant',
      error_description: 'Authorization code is invalid',
      code: SENTINELS.refreshToken
    });

    const safe = toSafeProviderError('xero', error, { operation: 'tokenExchange' });
    expect(safe.providerErrorCode).toBe('invalid_grant');
    expect(safe.message).toContain('Authorization code is invalid');
    expectNoSentinels(JSON.stringify(safe));
  });

  it('is deterministic for malformed or unexpected payloads', () => {
    for (const weird of [null, undefined, 42, 'boom', [], { response: null }, new Error('plain')]) {
      const safe = toSafeProviderError('qbo', weird);
      expect(safe.provider).toBe('qbo');
      expect(typeof safe.message).toBe('string');
    }
  });

  it('redacts token-shaped substrings inside messages', () => {
    const message = `failed: ${SENTINELS.authHeader} and token ${SENTINELS.accessToken}`;
    const sanitized = sanitizeProviderMessage(message);
    expectNoSentinels(sanitized);
    expect(sanitized).toContain('[REDACTED]');
  });
});

describe('sanitizeLogMeta', () => {
  it('redacts credential-shaped keys at any depth', () => {
    const meta = sanitizeLogMeta({
      tenantId: 'tenant-1',
      access_token: SENTINELS.accessToken,
      refreshToken: SENTINELS.refreshToken,
      nested: {
        client_secret: SENTINELS.clientSecret,
        headers: { Authorization: SENTINELS.authHeader, cookie: 'session=abc' }
      }
    });

    const serialized = JSON.stringify(meta);
    expectNoSentinels(serialized);
    expect(serialized).toContain('tenant-1');
    expect((meta as any).access_token).toBe('[REDACTED]');
    expect((meta as any).nested.headers.Authorization).toBe('[REDACTED]');
  });

  it('reduces embedded axios errors to the safe provider shape', () => {
    const meta = sanitizeLogMeta({ error: makeAxiosError({ Message: 'nope' }) }) as any;
    expectNoSentinels(JSON.stringify(meta));
    expect(meta.error.status).toBe(400);
    expect(meta.error.correlationId).toBe('tid-123');
  });

  it('scrubs token-shaped substrings from primitive string meta', () => {
    const sanitized = sanitizeLogMeta(
      `token exchange failed: ${SENTINELS.authHeader} refresh=${SENTINELS.refreshToken}`
    );
    expectNoSentinels(JSON.stringify(sanitized));
    expect(sanitized).toContain('token exchange failed');
    expect(sanitized).toContain('[REDACTED]');
  });

  it('scrubs strings inside array meta', () => {
    const sanitized = sanitizeLogMeta([
      'refresh failed',
      `authorization: ${SENTINELS.authHeader}`,
      { client_secret: SENTINELS.clientSecret }
    ]) as unknown[];
    expectNoSentinels(JSON.stringify(sanitized));
    expect(sanitized[0]).toBe('refresh failed');
  });

  it('sanitizes plain Error meta without leaking message secrets', () => {
    const sanitized = sanitizeLogMeta(
      new Error(`token endpoint rejected ${SENTINELS.accessToken}`)
    ) as any;
    expectNoSentinels(JSON.stringify(sanitized));
    expect(sanitized.name).toBe('Error');
    expect(sanitized.message).toContain('token endpoint rejected');
    expect(sanitized.stack).toBeUndefined();
  });

  it('is cycle-safe', () => {
    const a: any = { name: 'a' };
    a.self = a;
    expect(() => sanitizeLogMeta(a)).not.toThrow();
    expect((sanitizeLogMeta(a) as any).self).toBe('[Circular]');
  });
});

describe('logger redaction (defense in depth)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('never emits sentinel secrets passed as structured meta', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = (await import('./logger')).default;

    logger.error('provider failure', {
      tenantId: 'tenant-1',
      access_token: SENTINELS.accessToken,
      error: makeAxiosError({ refresh_token: SENTINELS.refreshToken })
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.stringify(errorSpy.mock.calls[0]);
    expectNoSentinels(emitted);
    expect(emitted).toContain('tenant-1');
  });

  it('never emits sentinel secrets passed as primitive string meta', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = (await import('./logger')).default;

    logger.error('token exchange failed', `authorization header was ${SENTINELS.authHeader}`);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.stringify(errorSpy.mock.calls[0]);
    expectNoSentinels(emitted);
    expect(emitted).toContain('token exchange failed');
  });

  it('never emits sentinel secrets passed as array or Error meta', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = (await import('./logger')).default;

    logger.warn('provider refresh issues', [
      `refresh token ${SENTINELS.refreshToken}`,
      new Error(`client secret ${SENTINELS.clientSecret} rejected`)
    ]);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.stringify(warnSpy.mock.calls[0]);
    expectNoSentinels(emitted);
    expect(emitted).toContain('provider refresh issues');
  });
});
