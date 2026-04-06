import { describe, expect, it } from 'vitest';
import { getRmmProviderMetadata } from './providerRegistry';

describe('RMM provider registry', () => {
  it('T001: exposes Tanium metadata and capability flags', () => {
    const tanium = getRmmProviderMetadata('tanium');
    expect(tanium).toBeDefined();
    expect(tanium?.title).toBe('Tanium');
    expect(tanium?.capabilities).toEqual({
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: false,
      remoteActions: false,
    });
  });
});
