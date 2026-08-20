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
  const valid = validateReleaseManifest({ ...base, supportAgent: 'ghcr.io/nine-minds/alga-appliance-support-agent@sha256:' + 'a'.repeat(64) });
  assert.match(valid.supportAgent, /@sha256:/);
  assert.equal(validateReleaseManifest(base).supportAgent, null);
  assert.throws(() => validateReleaseManifest({ ...base, supportAgent: 'ghcr.io/nine-minds/alga-appliance-support-agent:latest' }), /supportAgent/);
  assert.throws(() => validateReleaseManifest({ ...base, supportAgent: 'ghcr.io/other/support-agent@sha256:' + 'a'.repeat(64) }), /supportAgent/);
});
