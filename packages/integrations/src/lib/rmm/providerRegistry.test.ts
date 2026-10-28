import { describe, expect, it } from 'vitest';
import { getAvailableRmmProviderRegistry, getRmmProviderMetadata } from './providerRegistry';

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

  it('exposes Level metadata gated by enterprise', () => {
    const levelio = getRmmProviderMetadata('levelio');
    expect(levelio).toBeDefined();
    expect(levelio?.title).toBe('Level');
    expect(levelio?.requiresEnterprise).toBe(true);
    expect(levelio?.capabilities).toEqual({
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: false,
    });
  });

  it('exposes Huntress metadata gated by enterprise', () => {
    const huntress = getRmmProviderMetadata('huntress');
    expect(huntress).toBeDefined();
    expect(huntress?.title).toBe('Huntress');
    expect(huntress?.requiresEnterprise).toBe(true);
    expect(huntress?.capabilities).toEqual({
      connection: true,
      scopeSync: true,
      deviceSync: false,
      events: false,
      remoteActions: false,
    });
  });

  it('exposes Datto RMM metadata as an Enterprise provider', () => {
    const datto = getRmmProviderMetadata('datto');
    expect(datto).toBeDefined();
    expect(datto?.title).toBe('Datto RMM');
    expect(datto?.icon).toBe('datto');
    expect(datto?.requiresEnterprise).toBe(true);
    expect(datto?.badge).toEqual({ label: 'Enterprise', variant: 'secondary' });
    expect(datto?.capabilities).toEqual({
      connection: true,
      scopeSync: true,
      deviceSync: true,
      events: true,
      remoteActions: true,
    });
  });

  it('hides Datto RMM in Community Edition and lists it in Enterprise', () => {
    const ceIds = getAvailableRmmProviderRegistry({ isEnterprise: false }).map((provider) => provider.id);
    expect(ceIds).toEqual(['tacticalrmm']);
    const eeIds = getAvailableRmmProviderRegistry({ isEnterprise: true }).map((provider) => provider.id);
    expect(eeIds).toContain('datto');
  });
});
