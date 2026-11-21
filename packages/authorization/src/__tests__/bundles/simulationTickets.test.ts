import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ table: [] as string[], where: [] as unknown[], tenant: '' }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (_knex: unknown, tenant: string) => ({
    table: (name: string) => {
      calls.tenant = tenant; calls.table.push(name);
      const q: any = {
        orderBy: () => q, limit: () => q,
        where: (fn: any) => { const b: any = { whereILike: (...a: unknown[]) => { calls.where.push(a); return b; }, orWhereILike: (...a: unknown[]) => { calls.where.push(a); return b; } }; fn(b); return q; },
        select: async () => [
          { ticket_id: 't1', title: 'Printer is down', ticket_number: 'T-1001' },
          { ticket_id: 't2', title: null, ticket_number: 'T-1002' },
        ],
      };
      return q;
    },
  }),
}));

import { listSimulationTicketOptions } from '../../bundles/simulationTickets';

describe('simulation ticket options', () => {
  it('reads the tenant\'s tickets and names each by number and title, never by id', async () => {
    const options = await listSimulationTicketOptions({} as never, 'tenant-a');
    expect(calls.tenant).toBe('tenant-a');
    expect(calls.table).toEqual(['tickets']);
    expect(options).toEqual([{ id: 't1', label: 'T-1001 — Printer is down' }, { id: 't2', label: 'T-1002' }]);
  });

  it('narrows by number or title, escaping LIKE wildcards', async () => {
    calls.where = [];
    await listSimulationTicketOptions({} as never, 'tenant-a', '  50%_off ');
    expect(calls.where).toEqual([['title', '%50\\%\\_off%'], ['ticket_number', '%50\\%\\_off%']]);
  });
});
