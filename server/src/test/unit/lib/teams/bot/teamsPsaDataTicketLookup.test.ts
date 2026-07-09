import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    tickets: [] as Array<Record<string, unknown>>,
  };

  function makeBuilder(tenant: string) {
    let rows = state.tickets.filter((row) => row.tenant === tenant);

    const builder: any = {
      select: () => builder,
      where: (column: unknown, value?: unknown) => {
        if (typeof column === 'string') {
          const key = column.replace(/^t\./, '');
          rows = rows.filter((row) => row[key] === value);
        }
        return builder;
      },
      whereRaw: (sql: string, binds: unknown[]) => {
        if (sql.includes('LOWER("t"."ticket_number")')) {
          rows = rows.filter(
            (row) => String(row.ticket_number ?? '').toLowerCase() === String(binds[0])
          );
        } else if (sql.includes('~*')) {
          const pattern = new RegExp(String(binds[0]), 'i');
          rows = rows.filter((row) => pattern.test(String(row.ticket_number ?? '')));
        }
        return builder;
      },
      first: () => Promise.resolve(rows[0]),
    };
    return builder;
  }

  return {
    state,
    makeBuilder,
    createTenantKnexMock: vi.fn(async (tenant: string) => ({
      knex: { raw: (sql: string) => sql },
      tenant,
    })),
  };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: () => hoisted.makeBuilder(tenant),
    tenantJoin: () => undefined,
  }),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));

import { resolveTeamsTicketByReference } from '@alga-psa/ee-microsoft-teams/lib/teams/teamsPsaData';

describe('resolveTeamsTicketByReference (human ticket references)', () => {
  beforeEach(() => {
    hoisted.state.tickets.length = 0;
    hoisted.state.tickets.push(
      { tenant: 'tenant-1', ticket_id: 'ticket-a', ticket_number: '1234', title: 'Tenant 1 ticket' },
      { tenant: 'tenant-2', ticket_id: 'ticket-b', ticket_number: '1234', title: 'Tenant 2 ticket' },
      { tenant: 'tenant-1', ticket_id: 'ticket-c', ticket_number: 'alga0001833', title: 'Prefixed number' }
    );
  });

  it('T059: resolves a plain numeric ticket number, with or without a leading #', async () => {
    const byNumber = await resolveTeamsTicketByReference('1234', { tenant: 'tenant-1', userId: 'user-1' } as any);
    expect(byNumber?.ticket_id).toBe('ticket-a');

    const byHash = await resolveTeamsTicketByReference('#1234', { tenant: 'tenant-1', userId: 'user-1' } as any);
    expect(byHash?.ticket_id).toBe('ticket-a');
  });

  it('T060: ticket-number lookup is tenant-scoped — colliding numbers never leak across tenants', async () => {
    const tenant1 = await resolveTeamsTicketByReference('1234', { tenant: 'tenant-1', userId: 'user-1' } as any);
    const tenant2 = await resolveTeamsTicketByReference('1234', { tenant: 'tenant-2', userId: 'user-2' } as any);

    expect(tenant1?.ticket_id).toBe('ticket-a');
    expect(tenant2?.ticket_id).toBe('ticket-b');

    const missingTenant = await resolveTeamsTicketByReference('1833', { tenant: 'tenant-2', userId: 'user-2' } as any);
    expect(missingTenant).toBeNull();
  });

  it('T059: numeric references match prefixed/zero-padded ticket numbers', async () => {
    const resolved = await resolveTeamsTicketByReference('1833', { tenant: 'tenant-1', userId: 'user-1' } as any);
    expect(resolved?.ticket_id).toBe('ticket-c');

    // A different number must not match by suffix accident.
    const noMatch = await resolveTeamsTicketByReference('833', { tenant: 'tenant-1', userId: 'user-1' } as any);
    expect(noMatch).toBeNull();
  });

  it('returns null for unknown non-numeric references', async () => {
    const resolved = await resolveTeamsTicketByReference('not-a-ticket', { tenant: 'tenant-1', userId: 'user-1' } as any);
    expect(resolved).toBeNull();
  });
});
