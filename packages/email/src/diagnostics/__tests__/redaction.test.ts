import { describe, it, expect } from 'vitest';
import { redactDiagnosticsValue } from '../redaction';

describe('redactDiagnosticsValue', () => {
  it('redacts emails by default while preserving status codes and request ids', () => {
    const value = {
      http: { status: 403, requestId: 'req-1', clientRequestId: 'cli-1' },
      authenticatedUserEmail: 'admin@example.com',
      recommendations: ['Reconnect admin@example.com'],
    };
    const out = redactDiagnosticsValue(value, { includeIdentifiers: false }) as any;
    expect(out.http).toEqual({ status: 403, requestId: 'req-1', clientRequestId: 'cli-1' });
    expect(out.authenticatedUserEmail).toBe('[redacted-email]');
    expect(out.recommendations[0]).toBe('Reconnect [redacted-email]');
  });

  it('strips secret-bearing keys at any depth and keeps non-secret siblings', () => {
    const value = {
      provider: {
        apiKey: 'resend-key',
        api_key: 'resend-key-2',
        clientSecret: 'oauth-secret',
        client_secret: 'oauth-secret-2',
        password: 'smtp-pass',
        access_token: 'at',
        refreshToken: 'rt',
        Authorization: 'Bearer xyz',
        nested: { privateKey: 'pem', from: 'sender@example.com' },
      },
      steps: [{ data: { scp: ['Mail.Send'] } }],
    };
    const out = redactDiagnosticsValue(value, { includeIdentifiers: false }) as any;
    expect(out.provider.apiKey).toBe('[redacted]');
    expect(out.provider.api_key).toBe('[redacted]');
    expect(out.provider.clientSecret).toBe('[redacted]');
    expect(out.provider.client_secret).toBe('[redacted]');
    expect(out.provider.password).toBe('[redacted]');
    expect(out.provider.access_token).toBe('[redacted]');
    expect(out.provider.refreshToken).toBe('[redacted]');
    expect(out.provider.Authorization).toBe('[redacted]');
    expect(out.provider.nested.privateKey).toBe('[redacted]');
    expect(out.provider.nested.from).toBe('[redacted-email]');
    expect(out.steps[0].data.scp).toEqual(['Mail.Send']);
  });

  it('preserves identifiers when includeIdentifiers is true', () => {
    const out = redactDiagnosticsValue(
      { email: 'admin@example.com', nested: ['b@example.com'] },
      { includeIdentifiers: true },
    );
    expect(out).toEqual({ email: 'admin@example.com', nested: ['b@example.com'] });
  });

  it('passes through primitives and null', () => {
    expect(redactDiagnosticsValue(403, { includeIdentifiers: false })).toBe(403);
    expect(redactDiagnosticsValue(null, { includeIdentifiers: false })).toBeNull();
    expect(redactDiagnosticsValue(undefined, { includeIdentifiers: false })).toBeUndefined();
  });
});
