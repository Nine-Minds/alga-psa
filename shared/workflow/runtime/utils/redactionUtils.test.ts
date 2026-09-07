import { describe, expect, it } from 'vitest';
import { applyRedactions, enforceSnapshotSize, maskResolvedSecrets, safeSerialize } from './redactionUtils';

describe('workflow diagnostic redaction', () => {
  it('redacts both reference formats through nested arrays while preserving ordinary values', () => {
    const input = { rows: [{ secretRef: 'private-reference', visible: 'keep' },
      [{ $secret: 'provider-key' }]], credentials: { token: 'resolved-secret' } };
    const before = structuredClone(input);
    expect(safeSerialize(applyRedactions(input, ['/credentials/token']))).toEqual({
      rows: [{ secretRef: '[REDACTED]', visible: 'keep' }, [{ $secret: '[SECRET:REDACTED]' }]],
      credentials: { token: '[REDACTED]' },
    });
    expect(input).toEqual(before);
  });

  it('masks resolved secret paths without modifying the live action input or its nested aliases', () => {
    const credential = { 'api/key': { '~token': 'actual-secret' }, visible: 'keep' };
    const input = { credentials: [credential], alias: credential };
    const before = structuredClone(input);
    const masked = maskResolvedSecrets(input, ['/credentials/0/api~1key/~0token']);
    expect(masked).toEqual({
      credentials: [{ 'api/key': { '~token': '[REDACTED]' }, visible: 'keep' }],
      alias: before.alias,
    });
    expect(input).toEqual(before);
    expect(input.credentials[0]).toBe(credential);
    expect(input.credentials[0]['api/key']['~token']).toBe('actual-secret');
  });

  it('enforces the serialized UTF-8 byte limit and leaves valid JSON at the exact boundary', () => {
    const snapshot = { message: '💡漢字'.repeat(100) };
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
    expect(enforceSnapshotSize(snapshot, bytes)).toEqual(snapshot);
    const truncated = enforceSnapshotSize(snapshot, bytes - 1);
    expect(truncated).toEqual({ truncated: true, size: bytes, max: bytes - 1 });
    expect(JSON.parse(JSON.stringify(truncated))).toEqual(truncated);
    expect(snapshot.message).toBe('💡漢字'.repeat(100));
  });
});
