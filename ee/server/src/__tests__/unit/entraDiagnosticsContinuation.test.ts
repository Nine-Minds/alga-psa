import { describe, it, expect, afterEach } from 'vitest';
import {
  signContinuation,
  verifyContinuation,
  DiagnosticsSigningSecretUnavailableError,
  type EntraClientContinuationPayload,
} from '@ee/lib/integrations/entra/diagnostics/continuation';

const SECRET = 'unit-test-signing-secret-1234';

function basePayload(overrides: Partial<EntraClientContinuationPayload> = {}): EntraClientContinuationPayload {
  return {
    v: 1,
    tenant: 'tenant-1',
    userId: 'user-1',
    scope: 'clients',
    connectionType: 'direct',
    connectionId: 'conn-1',
    selection: [{ clientId: 'c1', managedTenantId: 'm1', entraTenantId: 'entra-1' }],
    includeUserYield: false,
    offset: 0,
    total: 1,
    results: [],
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

describe('continuation signing', () => {
  afterEach(() => {
    delete process.env.ENTRA_DIAGNOSTICS_JOB_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  it('round-trips a valid continuation with mapping identities', () => {
    const token = signContinuation(basePayload(), SECRET);
    const verified = verifyContinuation(token, SECRET);
    expect(verified?.tenant).toBe('tenant-1');
    expect(verified?.selection).toEqual([
      { clientId: 'c1', managedTenantId: 'm1', entraTenantId: 'entra-1' },
    ]);
  });

  it('rejects a tampered continuation', () => {
    const token = signContinuation(basePayload(), SECRET);
    const [body, sig] = token.split('.');
    expect(verifyContinuation(`${body}.${sig.slice(0, -2)}xx`, SECRET)).toBeNull();
  });

  it('rejects an expired continuation', () => {
    const token = signContinuation(basePayload({ exp: Date.now() - 1000 }), SECRET);
    expect(verifyContinuation(token, SECRET)).toBeNull();
  });

  it('rejects a continuation signed with a different secret', () => {
    const token = signContinuation(basePayload(), 'secret-a-1234567890');
    expect(verifyContinuation(token, 'secret-b-1234567890')).toBeNull();
  });

  it('rejects structurally invalid payloads', () => {
    // Missing selection and connectionId.
    const payload: any = basePayload();
    delete payload.selection;
    const token = signContinuation(payload, SECRET);
    expect(verifyContinuation(token, SECRET)).toBeNull();
  });

  it('rejects a payload whose results length disagrees with offset', () => {
    const payload = basePayload({ offset: 3, total: 3, results: [] });
    const token = signContinuation(payload, SECRET);
    expect(verifyContinuation(token, SECRET)).toBeNull();
  });

  it('fails safely when no deployment signing secret is configured', () => {
    delete process.env.ENTRA_DIAGNOSTICS_JOB_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(() => signContinuation(basePayload())).toThrow(DiagnosticsSigningSecretUnavailableError);
    expect(verifyContinuation('body.sig')).toBeNull();
  });
});
