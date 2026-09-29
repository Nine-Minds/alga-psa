import { describe, expect, it, vi } from 'vitest';
import Priority from './priority';

const queryState = vi.hoisted(() => ({
  tenantScope: undefined as string | undefined,
  rowFilter: undefined as Record<string, string> | undefined,
  updatePayload: undefined as Record<string, unknown> | undefined,
  persisted: null as Record<string, unknown> | null,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn((_connection: unknown, tenant: string) => {
    queryState.tenantScope = tenant;
    return {
      table: vi.fn(() => ({
        where: vi.fn((filter: Record<string, string>) => {
          queryState.rowFilter = filter;
          const query = {
            update: vi.fn((payload: Record<string, unknown>) => {
              queryState.updatePayload = payload;
              queryState.persisted = { ...queryState.persisted, ...payload };
              return { returning: vi.fn(async () => [queryState.persisted]) };
            }),
            then: (resolve: (rows: Array<Record<string, unknown>>) => unknown) =>
              Promise.resolve(resolve(queryState.persisted ? [queryState.persisted] : [])),
          };
          return query;
        }),
      })),
    };
  }),
}));

describe('Priority.update', () => {
  it('persists mutable fields without writing tenant or immutable identity fields', async () => {
    const persisted = {
      priority_id: 'priority-1',
      tenant: 'tenant-a',
      priority_name: 'Urgent',
      order_number: 1,
      color: '#123456',
      item_type: 'ticket',
      created_by: 'user-original',
      created_at: new Date('2026-01-01T00:00:00Z'),
    };
    Object.assign(queryState, {
      tenantScope: undefined,
      rowFilter: undefined,
      updatePayload: undefined,
      persisted,
    });

    const result = await Priority.update({} as never, 'tenant-a', 'priority-1', {
      ...persisted,
      color: '#ABCDEF',
      tenant: 'tenant-b',
      priority_id: 'priority-other',
      created_by: 'attacker',
    } as unknown as Parameters<typeof Priority.update>[3]);

    expect(queryState.tenantScope).toBe('tenant-a');
    expect(queryState.rowFilter).toEqual({ priority_id: 'priority-1' });
    expect(queryState.updatePayload).toEqual({
      priority_name: 'Urgent',
      order_number: 1,
      color: '#ABCDEF',
      item_type: 'ticket',
    });
    expect(queryState.updatePayload).not.toHaveProperty('tenant');
    expect(queryState.updatePayload).not.toHaveProperty('priority_id');
    expect(queryState.updatePayload).not.toHaveProperty('created_by');
    expect(result?.color).toBe('#ABCDEF');

    const fetchedAgain = await Priority.get({} as never, 'tenant-a', 'priority-1');
    expect(fetchedAgain?.color).toBe('#ABCDEF');
  });
});
