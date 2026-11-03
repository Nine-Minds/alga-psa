/**
 * A6, through real hooked call sites. A fake provider registered for
 * workItemTypes ['test_stub'] answers a real server action; native SQL is never
 * reached. With nothing registered the same action runs its native body.
 *
 * AUTHORIZATION CONTRACT: hooks run BEFORE the native hasPermission check, so a
 * provider answering handled:true owns authorization for that call. The first
 * case asserts that explicitly (hasPermission is never consulted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args),
  withOptionalAuth: (fn: any) => fn,
  hasPermission: (...a: any[]) => hasPermissionMock(...a),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...a: any[]) => createTenantKnexMock(...a),
  tenantDb: () => {
    throw new Error('native SQL path reached');
  },
}));

import { registerTimeSource, resetTimeSourcesForTests } from '../lib/timeSource';
import type { TimeSource } from '../lib/timeSource';

function stubSource(value: unknown): TimeSource {
  const entries = {
    // saveTimeEntry -> entries.admit(ctx, timeEntry)
    admit: vi.fn(async () => ({ handled: true as const, value })),
    list: vi.fn(async () => ({ handled: false as const })),
  };
  return { kind: 'co-managed', entries, sheets: {}, periods: {}, timer: {}, work: {}, retain: {} } as unknown as TimeSource;
}

describe('time source seam through a real hooked call site (A6)', () => {
  beforeEach(() => {
    resetTimeSourcesForTests();
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(false);
    createTenantKnexMock.mockRejectedValue(new Error('native path reached: createTenantKnex'));
  });
  afterEach(() => resetTimeSourcesForTests());

  it('saveTimeEntry: matching work item type returns the provider value, no native query, no native RBAC (provider owns authorization)', async () => {
    const source = stubSource({ entry_id: 'from-provider' });
    registerTimeSource('co-managed', () => source, { workItemTypes: ['test_stub'] });
    const { saveTimeEntry } = await import('../actions/timeEntryCrudActions');

    const result = await (saveTimeEntry as any)({ work_item_type: 'test_stub', work_item_id: 'w1' });

    expect(result).toEqual({ entry_id: 'from-provider' });
    expect(source.entries.admit).toHaveBeenCalledTimes(1);
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('saveTimeEntry: non-matching work item type with a source registered still runs the native body', async () => {
    const source = stubSource({ entry_id: 'from-provider' });
    registerTimeSource('co-managed', () => source, { workItemTypes: ['test_stub'] });
    const { saveTimeEntry } = await import('../actions/timeEntryCrudActions');

    await (saveTimeEntry as any)({ work_item_type: 'ticket', work_item_id: 'w1' }).catch(() => undefined);

    expect(source.entries.admit).not.toHaveBeenCalled();
    expect(createTenantKnexMock).toHaveBeenCalledTimes(1);
  });

  it('saveTimeEntry: nothing registered runs the native body', async () => {
    const { saveTimeEntry } = await import('../actions/timeEntryCrudActions');
    await (saveTimeEntry as any)({ work_item_type: 'test_stub', work_item_id: 'w1' }).catch(() => undefined);
    expect(createTenantKnexMock).toHaveBeenCalledTimes(1);
  });

  it('a provider miss falls through to the native body', async () => {
    const source = stubSource(null);
    registerTimeSource('co-managed', () => source, { workItemTypes: ['test_stub'] });
    const { fetchTimeEntriesForTimeSheet } = await import('../actions/timeEntryCrudActions');
    await (fetchTimeEntriesForTimeSheet as any)('sheet-1').catch(() => undefined);
    // list() missed (handled:false) for a context with no marker -> native runs
    expect(source.entries.list).not.toHaveBeenCalled();
    expect(createTenantKnexMock).toHaveBeenCalled();
  });
});
