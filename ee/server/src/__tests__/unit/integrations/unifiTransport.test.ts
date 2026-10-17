import { afterEach, describe, expect, it } from 'vitest';
import { unifiTransportOverride } from '../../../lib/integrations/unifi/sync/transport';

describe('unifiTransportOverride', () => {
  afterEach(() => {
    delete process.env.UNIFI_SYNC_TRANSPORT;
    delete process.env.RMM_SYNC_TRANSPORT;
  });

  it('defaults to temporal (Temporal-first provider)', () => {
    expect(unifiTransportOverride()).toBe('temporal');
  });

  it('honors the provider-specific env var first', () => {
    process.env.UNIFI_SYNC_TRANSPORT = 'direct';
    process.env.RMM_SYNC_TRANSPORT = 'temporal';
    expect(unifiTransportOverride()).toBe('direct');
  });

  it('falls back to the global env var', () => {
    process.env.RMM_SYNC_TRANSPORT = 'direct';
    expect(unifiTransportOverride()).toBe('direct');
  });

  it('ignores invalid values', () => {
    process.env.UNIFI_SYNC_TRANSPORT = 'banana';
    expect(unifiTransportOverride()).toBe('temporal');
  });
});
