import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseManifest } from '../setup-engine.mjs';

const base = {
  schema: 'alga.appliance.release/v1',
  version: '2026.08.20',
  images: { algaCore: 'ghcr.io/nine-minds/alga-core@sha256:' + 'b'.repeat(64) },
  config: { repository: 'nine-minds/alga-flux', digest: 'sha256:' + 'c'.repeat(64) },
};

test('release manifest preserves a valid support-agent digest and rejects tags or wrong repositories', () => {
  const valid = validateReleaseManifest({ ...base, supportAgent: 'ghcr.io/nine-minds/alga-appliance-support-agent@sha256:' + 'a'.repeat(64), supportReceiptKeys: { v2: '-----BEGIN PUBLIC KEY-----\ncurrent\n-----END PUBLIC KEY-----', v1: '-----BEGIN PUBLIC KEY-----\nprevious\n-----END PUBLIC KEY-----' } });
  assert.match(valid.supportAgent, /@sha256:/);
  assert.deepEqual(Object.keys(valid.supportReceiptKeys).sort(), ['v1', 'v2']);
  assert.equal(validateReleaseManifest(base).supportAgent, null);
  assert.throws(() => validateReleaseManifest({ ...base, supportAgent: 'ghcr.io/nine-minds/alga-appliance-support-agent:latest' }), /supportAgent/);
  assert.throws(() => validateReleaseManifest({ ...base, supportAgent: 'ghcr.io/other/support-agent@sha256:' + 'a'.repeat(64) }), /supportAgent/);
  assert.throws(() => validateReleaseManifest({ ...base, supportReceiptKeys: { v1: 'bad-key' } }), /receipt verification key/);
  assert.throws(() => validateReleaseManifest({ ...base, supportReceiptKeys: { v1: '-----BEGIN PUBLIC KEY-----\n1', v2: '-----BEGIN PUBLIC KEY-----\n2', v3: '-----BEGIN PUBLIC KEY-----\n3' } }), /at most one previous/);
});
