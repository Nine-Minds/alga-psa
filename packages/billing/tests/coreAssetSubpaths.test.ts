import { describe, expect, it } from 'vitest';
import { ASSET_SPEC_OPTIONS } from '@alga-psa/core/builtinAssetSpecs';
import { entityAssetsCacheKey } from '@alga-psa/core/assetCacheKeys';
import { parseNumberInput } from '@alga-psa/core/numberInput';

describe('billing test source resolution', () => {
  it('resolves the shared asset exports from their published source paths', () => {
    expect(ASSET_SPEC_OPTIONS.os).toContainEqual({ value: 'windows', label: 'Windows' });
    expect(entityAssetsCacheKey('ticket', 'ticket-1')).toEqual(['entity-assets', 'ticket', 'ticket-1']);
    expect(parseNumberInput('2.5', { integer: false })).toBe(2.5);
  });
});
