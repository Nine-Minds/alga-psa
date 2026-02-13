import { describe, expect, it } from 'vitest';
import type { Asset, RmmProvider } from './asset.interfaces';

describe('RmmProvider', () => {
  it('accepts tacticalrmm', () => {
    const provider: RmmProvider = 'tacticalrmm';
    expect(provider).toBe('tacticalrmm');

    const asset: Partial<Asset> = { rmm_provider: provider };
    expect(asset.rmm_provider).toBe('tacticalrmm');
  });
});

