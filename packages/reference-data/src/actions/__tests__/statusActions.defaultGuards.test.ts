import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'tenant-1';

const state = vi.hoisted(() => ({
  status: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
}));

function statusesTable() {
  const builder: any = {
    where: () => builder,
    whereNot: () => builder,
    max: () => builder,
    first: async () => state.status,
    update: async (patch: Record<string, unknown>) => {
      state.updates.push(patch);
      return [{ ...(state.status as Record<string, unknown>), ...patch }];
    },
    returning: () => builder,
    then: undefined,
  };
  // `.update(...).returning('*')` — knex returns the builder, so update must be chainable too.
  builder.update = (patch: Record<string, unknown>) => {
    state.updates.push(patch);
    const result = [{ ...(state.status as Record<string, unknown>), ...patch }];
    return { returning: async () => result };
  };
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: TENANT })),
  withTransaction: vi.fn(async (_db: unknown, fn: (trx: unknown) => unknown) => fn({})),
  tenantDb: () => ({ table: () => statusesTable() }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action({ user_id: 'user-1' }, { tenant: TENANT }, ...args),
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
}));

import { updateStatus } from '../status-actions/statusActions';
import { isStatusActionError, statusActionErrorMessage } from '../status-actions/statusActionErrors';

const openDefault = {
  status_id: 'status-planned',
  tenant: TENANT,
  name: 'Planned',
  status_type: 'interaction',
  is_closed: false,
  is_default: true,
  order_number: 1,
};

describe('updateStatus default/closed guards', () => {
  beforeEach(() => {
    state.updates = [];
    state.status = { ...openDefault };
  });

  it('refuses to close the status new interactions are created with', async () => {
    const result = await updateStatus('status-planned', { is_closed: true, is_default: false });

    expect(isStatusActionError(result)).toBe(true);
    expect(statusActionErrorMessage(result)).toBe('Set another status as the default before closing this one');
    expect(state.updates).toHaveLength(0);
  });

  it('refuses to make a closed status the default', async () => {
    state.status = { ...openDefault, status_id: 'status-completed', name: 'Completed', is_closed: true, is_default: false };

    const result = await updateStatus('status-completed', { is_default: true });

    expect(isStatusActionError(result)).toBe(true);
    expect(statusActionErrorMessage(result)).toBe('A closed status cannot be the default status');
    expect(state.updates).toHaveLength(0);
  });

  it('still allows editing a legacy closed default so it can be repaired', async () => {
    state.status = { ...openDefault, status_id: 'status-completed', name: 'Completed', is_closed: true, is_default: true };

    const result = await updateStatus('status-completed', { order_number: 5, is_closed: true, is_default: true });

    expect(isStatusActionError(result)).toBe(false);
    expect(state.updates.at(-1)).toMatchObject({ order_number: 5 });
  });

  it('allows promoting an open status to default', async () => {
    state.status = { ...openDefault, status_id: 'status-in-progress', name: 'In Progress', is_default: false };

    const result = await updateStatus('status-in-progress', { is_default: true });

    expect(isStatusActionError(result)).toBe(false);
    expect(state.updates.at(-1)).toMatchObject({ is_default: true });
  });
});
