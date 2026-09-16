import { describe, it, expect } from 'vitest';
import { redactText } from '@ee/lib/integrations/entra/diagnostics/redaction';
import { signContinuation, verifyContinuation } from '@ee/lib/integrations/entra/diagnostics/continuation';

describe('redactText', () => {
  it('redacts JWTs and bearer tokens but retains request ids', () => {
    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
    const text = `Authorization: Bearer ${jwt} request-id=rid-123`;
    const redacted = redactText(text, true);
    expect(redacted).not.toContain(jwt);
    expect(redacted).toContain('request-id=rid-123');
    expect(redacted).toContain('Bearer <redacted>');
  });

  it('redacts GUIDs by default but keeps them when identifiers are included', () => {
    const guid = '11111111-2222-3333-4444-555555555555';
    expect(redactText(`tenant ${guid}`, false)).toBe('tenant <id>');
    expect(redactText(`tenant ${guid}`, true)).toBe(`tenant ${guid}`);
  });
});

describe('continuation signing', () => {
  const base = {
    v: 1 as const,
    tenant: 'tenant-1',
    userId: 'user-1',
    scope: 'clients' as const,
    connectionType: 'direct' as const,
    clientIds: ['c1', 'c2'],
    includeUserYield: false,
    offset: 1,
    total: 2,
    results: [],
    exp: Date.now() + 60_000,
  };

  it('round-trips a valid continuation', () => {
    const token = signContinuation(base, 'test-secret');
    const verified = verifyContinuation(token, 'test-secret');
    expect(verified?.tenant).toBe('tenant-1');
    expect(verified?.clientIds).toEqual(['c1', 'c2']);
  });

  it('rejects a tampered continuation', () => {
    const token = signContinuation(base, 'test-secret');
    const [body, sig] = token.split('.');
    const tampered = `${body}.${sig.slice(0, -2)}xx`;
    expect(verifyContinuation(tampered, 'test-secret')).toBeNull();
  });

  it('rejects expired continuations', () => {
    const token = signContinuation({ ...base, exp: Date.now() - 1000 }, 'test-secret');
    expect(verifyContinuation(token, 'test-secret')).toBeNull();
  });

  it('rejects a continuation signed with a different secret', () => {
    const token = signContinuation(base, 'secret-a');
    expect(verifyContinuation(token, 'secret-b')).toBeNull();
  });
});
