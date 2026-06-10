import { afterEach, describe, expect, it } from 'vitest';
import { levelIoTransportOverride } from '../../../lib/integrations/levelio/sync/transport';

describe('levelIoTransportOverride', () => {
  afterEach(() => {
    delete process.env.LEVELIO_SYNC_TRANSPORT;
    delete process.env.RMM_SYNC_TRANSPORT;
  });

  it('defaults to temporal (Temporal-first provider)', () => {
    expect(levelIoTransportOverride()).toBe('temporal');
  });

  it('honors the provider-specific env var first', () => {
    process.env.LEVELIO_SYNC_TRANSPORT = 'direct';
    process.env.RMM_SYNC_TRANSPORT = 'temporal';
    expect(levelIoTransportOverride()).toBe('direct');
  });

  it('falls back to the global env var', () => {
    process.env.RMM_SYNC_TRANSPORT = 'direct';
    expect(levelIoTransportOverride()).toBe('direct');
  });

  it('ignores invalid values', () => {
    process.env.LEVELIO_SYNC_TRANSPORT = 'banana';
    expect(levelIoTransportOverride()).toBe('temporal');
  });
});
