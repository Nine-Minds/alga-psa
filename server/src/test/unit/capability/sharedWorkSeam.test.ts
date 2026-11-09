import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { registerFeatureFlagChecker } from '@alga-psa/core/features';
import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { sharedWorkSeam } from '../../../../../shared/utils/sharedWorkSeam';

const host = globalThis as unknown as Record<symbol, unknown>;

describe('sharedWorkSeam capability typing and slot symbol', () => {
  beforeEach(() => {
    vi.stubEnv('FORCE_CAPABILITIES', '');
    registerFeatureFlagChecker(async () => true);
    clearCapabilityCache();
  });
  afterEach(() => {
    delete host[Symbol.for('alga.sharedWorkSeam.probe')];
    delete host[Symbol.for('alga.sharedWorkSeam.ticket-conversations.probe')];
    resetCapabilityRegistry();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('alga.core.featureFlagChecker')];
    vi.unstubAllEnvs();
  });

  it('keeps the historical slot symbol for co-managed (default and explicit)', () => {
    sharedWorkSeam<object>('probe').register(() => ({}));
    expect(host[Symbol.for('alga.sharedWorkSeam.probe')]).toBeDefined();
    sharedWorkSeam<object>('probe', 'co-managed').reset();
    expect(host[Symbol.for('alga.sharedWorkSeam.probe')]).toBeUndefined();
  });

  it('namespaces the slot of any other capability, so the same seam name cannot collide', () => {
    const cm = sharedWorkSeam<object>('probe');
    const tc = sharedWorkSeam<object>('probe', 'ticket-conversations');
    cm.register(() => ({}));
    expect(tc.hasProvider()).toBe(false);
    tc.register(() => ({})); // would throw on a collision
    expect(host[Symbol.for('alga.sharedWorkSeam.ticket-conversations.probe')]).toBeDefined();
    expect(cm.hasProvider()).toBe(true);
    tc.reset();
    expect(cm.hasProvider()).toBe(true);
    cm.reset();
  });

  it('delegates for a tenant the seam capability serves, and only for that capability', async () => {
    const provider = { id: 'p' };
    const tc = sharedWorkSeam<typeof provider>('probe', 'ticket-conversations');
    tc.register(() => provider);
    // ticket-conversations is admitted but unserved until participation is registered.
    expect(await tc.resolve('t1')).toBeNull();
    registerCapabilityParticipation('ticket-conversations', async ({ tenantIds }) => tenantIds.filter((t) => t === 't1'));
    clearCapabilityCache();
    expect(await tc.resolve('t1')).toBe(provider);
    expect(await tc.resolve('t2')).toBeNull();
    tc.reset();
  });
});
