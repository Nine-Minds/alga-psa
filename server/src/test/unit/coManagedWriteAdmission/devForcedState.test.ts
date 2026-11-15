import { afterEach, describe, expect, it, vi } from 'vitest';
import { devForcedStatesFromEnv, resolveInstalledReader } from '@alga-psa/licensing/co-managed-write-admission';

const READ_ONLY = { state: 'read_only', canWrite: false, graceEndsAt: null } as const;

afterEach(() => vi.unstubAllEnvs());

describe('dev/test-only forced lifecycle state (CM L0c, review video)', () => {
  it('parses tenant:state pairs and skips unknown states', () => {
    expect(devForcedStatesFromEnv({ NODE_ENV: 'development', CO_MANAGED_DEV_FORCE_STATE: 't1:read_only, t2:pending_acceptance,t3:bogus' })).toEqual({
      t1: { state: 'read_only', canWrite: false, graceEndsAt: null },
      t2: { state: 'pending_acceptance', canWrite: false, graceEndsAt: null },
    });
  });

  it('is unreachable in production: env parsing returns nothing', () => {
    expect(devForcedStatesFromEnv({ NODE_ENV: 'production', CO_MANAGED_DEV_FORCE_STATE: 't1:read_only' })).toBeUndefined();
  });

  it('is unreachable in production even when handed straight to the installer', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reader = resolveInstalledReader({ devForcedStates: { t1: READ_ONLY } });
    expect(reader).toBeUndefined();
  });

  it('outside production forces the listed tenants only and delegates the rest', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const delegate = vi.fn(async () => ({ state: 'active', canWrite: true, graceEndsAt: null }) as const);
    const reader = resolveInstalledReader({ readState: delegate, devForcedStates: { t1: READ_ONLY } })!;
    expect(await reader({} as any, 't1')).toEqual(READ_ONLY);
    expect((await reader({} as any, 't2')).canWrite).toBe(true);
    expect(delegate).toHaveBeenCalledTimes(1);
  });

  it('adds nothing when no tenant is forced', () => {
    expect(resolveInstalledReader({})).toBeUndefined();
  });
});
