import { describe, expect, it } from 'vitest';
import { matchAssetCacheKeys } from './assetCacheKeys';

describe('matchAssetCacheKeys', () => {
  it('matches every cache key scoped to the given asset', () => {
    const match = matchAssetCacheKeys(['a1']);
    expect(match(['asset', 'a1'])).toBe(true);
    expect(match(['asset', 'a1', 'summary'])).toBe(true);
    expect(match(['asset', 'a1', 'history'])).toBe(true);
    expect(match(['asset', 'a1', 'relationship-candidates', 'client-1', ''])).toBe(true);
  });

  it('leaves other assets and other namespaces alone', () => {
    const match = matchAssetCacheKeys(['a1']);
    expect(match(['asset', 'a2', 'summary'])).toBe(false);
    expect(match(['asset-groups', 'a1'])).toBe(false);
    expect(match('/api/assets/a1')).toBe(false);
    expect(match(['asset'])).toBe(false);
    expect(match(null)).toBe(false);
  });

  it('matches any of several assets and ignores blank ids', () => {
    const match = matchAssetCacheKeys(['a1', null, undefined, 'a3', '']);
    expect(match(['asset', 'a1'])).toBe(true);
    expect(match(['asset', 'a3', 'tickets'])).toBe(true);
    expect(match(['asset', 'a2'])).toBe(false);
  });

  it('matches nothing when no asset is given', () => {
    const match = matchAssetCacheKeys([]);
    expect(match(['asset', 'a1'])).toBe(false);
  });
});
