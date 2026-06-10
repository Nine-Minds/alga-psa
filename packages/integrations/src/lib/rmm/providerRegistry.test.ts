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

  it('exposes Level metadata gated by enterprise and feature flag', () => {
    const levelio = getRmmProviderMetadata('levelio');
    expect(levelio).toBeDefined();
    expect(levelio?.title).toBe('Level');
    expect(levelio?.requiresEnterprise).toBe(true);
    expect(levelio?.featureFlagKey).toBe('levelio-rmm-integration');
    expect(levelio?.capabilities).toEqual({
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: false,
    });
  });

  it('exposes Huntress metadata gated by enterprise without a feature flag', () => {
    const huntress = getRmmProviderMetadata('huntress');
    expect(huntress).toBeDefined();
    expect(huntress?.title).toBe('Huntress');
    expect(huntress?.requiresEnterprise).toBe(true);
    expect(huntress?.featureFlagKey).toBeUndefined();
    expect(huntress?.capabilities).toEqual({
      connection: true,
      scopeSync: true,
      deviceSync: false,
      events: false,
      remoteActions: false,
    });
  });
});
