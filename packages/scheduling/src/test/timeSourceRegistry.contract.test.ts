import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args),
  hasPermission: (...a: any[]) => hasPermissionMock(...a),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...a: any[]) => createTenantKnexMock(...a),
  tenantDb: () => {
    throw new Error('native SQL path reached');
  },
}));

import {
  registerTimeSource,
  resolveTimeSource,
  resetTimeSourcesForTests,
  nativeTimeSource,
  delegateToTimeSource,
} from '../lib/timeSource';
import type { TimeSource } from '../lib/timeSource';

function fakeSource(handled: boolean): TimeSource {
  const hit = async () => (handled ? { handled: true as const, value: [{ entry_id: 'fake' }] } : { handled: false as const });
  return {
    kind: 'co-managed',
    entries: { list: hit } as any,
    sheets: {} as any,
    periods: {} as any,
    timer: {} as any,
    work: {} as any,
    retain: {} as any,
  } as unknown as TimeSource;
}

describe('time source registry contract (A6)', () => {
  beforeEach(() => {
    resetTimeSourcesForTests();
    vi.clearAllMocks();
  });
  afterEach(() => resetTimeSourcesForTests());

  it('resolves to native with nothing registered and never queries', async () => {
    const src = await resolveTimeSource({ tenant: 't1', workItemType: 'ticket' });
    expect(src).toBe(nativeTimeSource);
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(Object.isFrozen(nativeTimeSource)).toBe(true);
  });

  it('throws on a duplicate registration for the same kind, and on native', () => {
    registerTimeSource('co-managed', () => fakeSource(true), { rowMarkers: ['x'] });
    expect(() => registerTimeSource('co-managed', () => fakeSource(true))).toThrow(/already registered/);
    expect(() => registerTimeSource('native' as any, () => fakeSource(true))).toThrow();
  });

  it('a handled provider skips the native SQL', async () => {
    registerTimeSource('co-managed', () => fakeSource(true), { rowMarkers: ['cm'] });
    const direct = await delegateToTimeSource({ tenant: 't1', rowMarker: 'cm' }, (s, c) => s.entries.list(c, 'sheet'));
    expect(direct).toEqual({ handled: true, value: [{ entry_id: 'fake' }] });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('a miss falls through to the native body', async () => {
    registerTimeSource('co-managed', () => fakeSource(false), { rowMarkers: ['cm'] });
    const miss = await delegateToTimeSource({ tenant: 't1', rowMarker: 'cm' }, (s, c) => s.entries.list(c, 'sheet'));
    expect(miss).toEqual({ handled: false });
  });

  it('a non-matching context stays native without invoking the provider', async () => {
    const factory = vi.fn(() => fakeSource(true));
    registerTimeSource('co-managed', factory, { rowMarkers: ['cm'], workItemIdPrefixes: ['cm_'] });
    expect(await resolveTimeSource({ tenant: 't1', workItemId: 'abc' })).toBe(nativeTimeSource);
    expect(factory).not.toHaveBeenCalled();
    expect((await resolveTimeSource({ tenant: 't1', workItemId: 'cm_9' })).kind).toBe('co-managed');
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('native forwarders are lazy: resolving native touches no action module state', async () => {
    const r = await nativeTimeSource.entries.billingMode({ tenant: 't1' } as any, 'e1' as any);
    expect(r).toEqual({ handled: true, value: 'commercial' });
  });
});

describe('time source registry is shared across module instances', () => {
  afterEach(() => resetTimeSourcesForTests());

  it('a provider registered through one module instance is seen and cleared through another', async () => {
    const a = await import('../lib/timeSource');
    vi.resetModules();
    const b = await import('../lib/timeSource');
    expect(b).not.toBe(a);

    a.resetTimeSourcesForTests();
    a.registerTimeSource('co-managed', () => fakeSource(true), { rowMarkers: ['cm'] });

    expect(b.hasRegisteredTimeSources()).toBe(true);
    const src = await b.resolveTimeSource({ tenant: 't1', rowMarker: 'cm' });
    expect(src.kind).toBe('co-managed');
    const out = await b.delegateToTimeSource({ tenant: 't1', rowMarker: 'cm' }, (s, c) =>
      (s.entries as any).list(c),
    );
    expect(out).toMatchObject({ handled: true, value: [{ entry_id: 'fake' }] });

    b.resetTimeSourcesForTests();
    expect(a.hasRegisteredTimeSources()).toBe(false);

    b.registerTimeSource('co-managed', () => fakeSource(true));
    expect(a.hasRegisteredTimeSources()).toBe(true);
    a.resetTimeSourcesForTests();
    expect(b.hasRegisteredTimeSources()).toBe(false);
  });
});
