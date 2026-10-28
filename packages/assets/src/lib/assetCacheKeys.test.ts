import { describe, expect, it } from 'vitest';
import { matchAnyEntityAssetsKeys, matchAssetCacheKeys, ticketAssetsKey } from './assetCacheKeys';

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

describe('ticketAssetsKey', () => {
  it('is matched for the entity that changed, and only that entity', () => {
    const match = matchAssetCacheKeys(['a1', 'ticket-1']);
    expect(match(ticketAssetsKey('ticket', 'ticket-1') as unknown)).toBe(true);
    expect(match(ticketAssetsKey('ticket', 'ticket-2') as unknown)).toBe(false);
    // an asset id never matches an entity key it merely shares a position with
    expect(matchAssetCacheKeys(['a1'])(ticketAssetsKey('ticket', 'ticket-1') as unknown)).toBe(false);
  });

  it('matchAnyEntityAssetsKeys matches every entity panel and nothing else', () => {
    expect(matchAnyEntityAssetsKeys(ticketAssetsKey('project', 'p1'))).toBe(true);
    expect(matchAnyEntityAssetsKeys(['asset', 'a1'])).toBe(false);
    expect(matchAnyEntityAssetsKeys(null)).toBe(false);
  });
});
