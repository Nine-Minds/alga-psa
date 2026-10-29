import { describe, expect, it } from 'vitest';

// Regression: the EE vitest config mapped every `@alga-psa/core/<subpath>` to
// `packages/core/src/lib/<subpath>`, so exported subpaths living outside src/lib
// (config/deletion) failed at collection and took out a whole enterprise-unit shard.
describe('EE vitest resolves @alga-psa/core exported subpaths', () => {
  it('loads @alga-psa/core/config/deletion from its exported source', async () => {
    const deletion = await import('@alga-psa/core/config/deletion');
    expect(typeof deletion.countLiveCoManagedWorkspacesForClient).toBe('function');
    expect(typeof deletion.getDeletionConfig).toBe('function');
  });

  it('keeps src/lib subpaths resolving through the same exports map', async () => {
    const features = await import('@alga-psa/core/features');
    expect(features).toBeTruthy();
  });
});
