import { describe, expect, it } from 'vitest';
import { encryptActionReplay, decryptActionReplay } from './actionReplayCipher';

const key = 'synthetic-workflow-key-with-no-production-access';
const identity = { tenantId: 'tenant-a', invocationId: 'invocation-a' };
const result = { token: 'sensitive-result', secretRef: 'private-reference', rows: [null, 42, false, { unicode: '漢字💡' }] };

describe('encrypted workflow action replay', () => {
  it('round-trips the original JSON result without persisting readable sensitive fields', () => {
    const envelope = encryptActionReplay(result, key, identity);
    expect(decryptActionReplay(JSON.parse(JSON.stringify(envelope)), key, identity)).toEqual(result);
    expect(JSON.stringify(envelope)).not.toContain('sensitive-result');
    expect(JSON.stringify(envelope)).not.toContain('private-reference');
    expect(result.token).toBe('sensitive-result');
  });
  it('uses a fresh nonce for repeated results', () => {
    const first = encryptActionReplay(result, key, identity), second = encryptActionReplay(result, key, identity);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decryptActionReplay(second, key, identity)).toEqual(result);
  });
  it.each([
    { tenantId: 'tenant-b', invocationId: 'invocation-a' },
    { tenantId: 'tenant-a', invocationId: 'invocation-b' },
    { tenantId: null, invocationId: 'invocation-a' },
  ])('rejects replay under a different identity: %j', other => {
    expect(() => decryptActionReplay(encryptActionReplay(result, key, identity), key, other)).toThrow('Unable to authenticate');
  });
  it('rejects the wrong key', () => {
    expect(() => decryptActionReplay(encryptActionReplay(result, key, identity), 'different-key', identity)).toThrow('Unable to authenticate');
  });
  it.each(['nonce', 'tag', 'ciphertext'] as const)('rejects tampered %s', field => {
    const envelope = encryptActionReplay(result, key, identity);
    const bytes = Buffer.from(envelope[field], 'base64'); bytes[0] ^= 1;
    expect(() => decryptActionReplay({ ...envelope, [field]: bytes.toString('base64') }, key, identity)).toThrow('Unable to authenticate');
  });
  it.each([null, {}, { version: 2 }, { version: 1, nonce: 'invalid', tag: '', ciphertext: '' }])('rejects malformed or unsupported envelopes: %j', envelope => {
    expect(() => decryptActionReplay(envelope, key, identity)).toThrow('Unable to authenticate');
  });
  it('supports legacy tenantless invocations without allowing cross-tenant replay', () => {
    const legacy = { tenantId: null, invocationId: 'legacy' };
    const envelope = encryptActionReplay(null, key, legacy);
    expect(decryptActionReplay(envelope, key, legacy)).toBeNull();
    expect(() => decryptActionReplay(envelope, key, { ...legacy, tenantId: 'tenant-a' })).toThrow();
  });
  it('requires explicit key material and invocation identity', () => {
    expect(() => encryptActionReplay(result, '', identity)).toThrow('key is required');
    expect(() => encryptActionReplay(result, key, { ...identity, invocationId: '' })).toThrow('identity is required');
    expect(() => encryptActionReplay(undefined, key, identity)).toThrow('JSON serializable');
  });
});
