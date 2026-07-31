import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { isTenantSuspended, resumeTenant, suspendTenant } from './tenantSuspension';

interface TenantRow {
  tenant: string;
  suspended_at: string | null;
  suspended_reason: string | null;
}

function createKnex(row: TenantRow | null, options: { failLookup?: boolean } = {}) {
  const state = { row };
  const knex: any = vi.fn(() => {
    const predicates: Record<string, unknown> = {};
    let requireNull = false;
    let requireNotNull = false;
    const builder: any = {
      where(conditions: Record<string, unknown>) {
        Object.assign(predicates, conditions);
        return builder;
      },
      whereNull() {
        requireNull = true;
        return builder;
      },
      whereNotNull() {
        requireNotNull = true;
        return builder;
      },
      async first() {
        if (options.failLookup) throw new Error('connection refused');
        if (!state.row || predicates.tenant !== state.row.tenant) return undefined;
        return state.row;
      },
      async update(values: Partial<TenantRow>) {
        if (!state.row || predicates.tenant !== state.row.tenant) return 0;
        if (requireNull && state.row.suspended_at) return 0;
        if (requireNotNull && !state.row.suspended_at) return 0;
        if ('suspended_reason' in predicates
          && predicates.suspended_reason !== state.row.suspended_reason) return 0;
        Object.assign(state.row, values);
        return 1;
      },
    };
    return builder;
  });
  knex.fn = { now: vi.fn(() => '2026-07-24T12:00:00.000Z') };
  return { knex: knex as Knex, state };
}

describe('tenantSuspension helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T003: isTenantSuspended reflects the flag and returns false for unknown tenants', async () => {
    const suspended = createKnex({ tenant: 't1', suspended_at: '2026-07-24T00:00:00Z', suspended_reason: 'tenant_cancelled' });
    await expect(isTenantSuspended(suspended.knex, 't1')).resolves.toBe(true);

    const active = createKnex({ tenant: 't1', suspended_at: null, suspended_reason: null });
    await expect(isTenantSuspended(active.knex, 't1')).resolves.toBe(false);
    await expect(isTenantSuspended(active.knex, 'unknown')).resolves.toBe(false);
  });

  it('T004: isTenantSuspended fails open when the lookup throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { knex } = createKnex(null, { failLookup: true });

    await expect(isTenantSuspended(knex, 't1')).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('T005: suspendTenant stamps flag and reason when unsuspended', async () => {
    const { knex, state } = createKnex({ tenant: 't1', suspended_at: null, suspended_reason: null });

    await expect(suspendTenant(knex, 't1', 'tenant_cancelled')).resolves.toBe(true);
    expect(state.row).toMatchObject({
      suspended_at: '2026-07-24T12:00:00.000Z',
      suspended_reason: 'tenant_cancelled',
    });
  });

  it('T006: suspendTenant never overwrites an existing suspension', async () => {
    const { knex, state } = createKnex({
      tenant: 't1',
      suspended_at: '2026-07-01T00:00:00Z',
      suspended_reason: 'tenant_cancelled',
    });

    await expect(suspendTenant(knex, 't1', 'tenant_cancelled')).resolves.toBe(false);
    expect(state.row?.suspended_at).toBe('2026-07-01T00:00:00Z');
  });

  it('T007: resumeTenant clears a matching-reason suspension', async () => {
    const { knex, state } = createKnex({
      tenant: 't1',
      suspended_at: '2026-07-01T00:00:00Z',
      suspended_reason: 'tenant_cancelled',
    });

    await expect(resumeTenant(knex, 't1', 'tenant_cancelled')).resolves.toBe(true);
    expect(state.row).toMatchObject({ suspended_at: null, suspended_reason: null });
  });

  it('T008: resumeTenant leaves non-matching reasons untouched', async () => {
    const { knex, state } = createKnex({
      tenant: 't1',
      suspended_at: '2026-07-01T00:00:00Z',
      suspended_reason: 'manual-future-reason',
    });

    await expect(resumeTenant(knex, 't1', 'tenant_cancelled')).resolves.toBe(false);
    expect(state.row?.suspended_at).toBe('2026-07-01T00:00:00Z');
  });
});
