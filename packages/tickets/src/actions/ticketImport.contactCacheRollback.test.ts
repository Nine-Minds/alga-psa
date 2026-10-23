// @vitest-environment node

/**
 * The importer caches contacts it mints during a run so two rows naming the same
 * person share one contact. That cache lives outside the database, so every
 * savepoint rollback has to be mirrored into it — otherwise a row that creates a
 * contact and then fails leaves the cache pointing at a row that no longer
 * exists, and every later row naming that contact fails on the foreign key.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

/**
 * A savepoint-aware stand-in for the transaction: SAVEPOINT snapshots the row
 * stores, ROLLBACK TO SAVEPOINT restores them, RELEASE drops the snapshot.
 */
const fake = vi.hoisted(() => {
  const store: Record<string, Row[]> = {
    contacts: [],
    tickets: [],
    statuses: [],
    priorities: [],
    boards: [],
  };
  const savepoints: Array<{ name: string; contacts: number; tickets: number }> = [];
  let seq = 0;

  function reset() {
    store.contacts = [];
    store.tickets = [];
    store.statuses = [
      { status_id: 'status-1', name: 'Open', status_type: 'ticket', board_id: 'board-1', is_default: true, is_closed: false },
    ];
    store.priorities = [
      { priority_id: 'priority-1', priority_name: 'Low', item_type: 'ticket', order_number: 1 },
    ];
    store.boards = [{ board_id: 'board-1', priority_type: 'custom' }];
    savepoints.length = 0;
    seq = 0;
  }

  function builder(table: string): any {
    const wheres: Row[] = [];
    let insertRow: Row | null = null;
    let isMax = false;

    const matches = (row: Row) =>
      wheres.every((w) => Object.entries(w).every(([k, v]) => row[k] === v));

    async function resolve(): Promise<Row[]> {
      if (insertRow) {
        const idColumn = table === 'contacts' ? 'contact_name_id' : `${table.replace(/s$/, '')}_id`;
        const row = { ...insertRow, [idColumn]: `${table}-${++seq}` };
        (store[table] ??= []).push(row);
        return [row];
      }
      if (isMax) return [{ max: (store[table] ?? []).length }];
      return (store[table] ?? []).filter(matches);
    }

    const self: any = {
      where(arg: unknown) {
        if (arg && typeof arg === 'object') wheres.push(arg as Row);
        return self;
      },
      whereIn: () => self,
      whereNot: () => self,
      select: () => self,
      orderBy: () => self,
      max: () => {
        isMax = true;
        return self;
      },
      insert(row: Row) {
        insertRow = row;
        return self;
      },
      returning: () => self,
      async first() {
        return (await resolve())[0];
      },
      then(onFulfilled: any, onRejected: any) {
        return resolve().then(onFulfilled, onRejected);
      },
    };
    return self;
  }

  const trx: any = {
    raw(sql: string) {
      const rollback = /^\s*ROLLBACK TO SAVEPOINT\s+(\S+)/i.exec(sql);
      if (rollback) {
        const idx = savepoints.findIndex((s) => s.name === rollback[1]);
        if (idx >= 0) {
          store.contacts.length = savepoints[idx].contacts;
          store.tickets.length = savepoints[idx].tickets;
          savepoints.length = idx;
        }
        return undefined;
      }
      const release = /^\s*RELEASE SAVEPOINT\s+(\S+)/i.exec(sql);
      if (release) {
        const idx = savepoints.findIndex((s) => s.name === release[1]);
        if (idx >= 0) savepoints.splice(idx, 1);
        return undefined;
      }
      const savepoint = /^\s*SAVEPOINT\s+(\S+)/i.exec(sql);
      if (savepoint) {
        savepoints.push({
          name: savepoint[1],
          contacts: store.contacts.length,
          tickets: store.tickets.length,
        });
        return undefined;
      }
      return { __raw: sql };
    },
  };

  return { store, builder, trx, reset };
});

const createTicketMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
  localizeActionError: async (result: unknown) => result,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: () => ({ table: (table: string) => fake.builder(table) }),
  withTransaction: async (_db: unknown, cb: any) => cb(fake.trx),
}));
vi.mock('@alga-psa/core', () => ({ unparseCSV: vi.fn(() => '') }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntityWithTransaction: vi.fn(),
}));
vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: { createTicket: createTicketMock },
}));
vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  TICKET_ACTIVITY_ACTOR: {},
  TICKET_ACTIVITY_ENTITY: {},
  TICKET_ACTIVITY_EVENT: {},
  TICKET_ACTIVITY_SOURCE: {},
  writeTicketActivity: vi.fn(),
}));
vi.mock('@alga-psa/shared/lib/ticketCloseRules', () => ({
  closeRulesHaveEnabledGates: vi.fn(() => false),
  getBoardCloseRulesRow: vi.fn(async () => null),
}));

import { importTickets } from './ticketImportActions';

function ticketRow(overrides: Record<string, unknown>) {
  return {
    title: 'Printer offline',
    description: null,
    status_id: null,
    priority_id: null,
    board_id: 'board-1',
    category_id: null,
    subcategory_id: null,
    client_id: 'client-1',
    contact_id: '__create__:Shared Contact',
    assigned_to: null,
    assigned_team_id: null,
    due_date: null,
    entered_at: null,
    closed_at: null,
    is_closed: false,
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();

  let ticketSeq = 0;
  createTicketMock.mockImplementation(async (input: Row) => {
    // Stands in for the tickets_contact_name_id_fkey constraint: a contact id
    // that was rolled back no longer exists, so the insert must fail.
    if (input.contact_id && !fake.store.contacts.some((c) => c.contact_name_id === input.contact_id)) {
      throw Object.assign(new Error('violates foreign key constraint "tickets_contact_name_id_fkey"'), {
        code: '23503',
      });
    }
    if (input.title === 'Bad row') {
      throw new Error('ticket insert blew up');
    }
    const ticket = { ticket_id: `ticket-${++ticketSeq}`, ticket_number: `TK-${ticketSeq}`, ...input };
    fake.store.tickets.push(ticket);
    return ticket;
  });
});

describe('importTickets contact cache after a per-row rollback', () => {
  it('lets a later row reuse a contact name after an earlier row rolled back', async () => {
    const result: any = await importTickets(
      [
        ticketRow({ title: 'Bad row', rowNumber: 2 }),
        ticketRow({ title: 'Good row', rowNumber: 3 }),
      ] as any,
      [] as any,
      [] as any,
      [{ action: 'create' }] as any,
      [] as any,
      [] as any,
      'board-1',
    );

    // Row N is reported, row N+1 still lands.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Row 2/);
    expect(result.ticketsCreated).toBe(1);
    expect(result.ticketNumbers).toEqual(['TK-1']);

    // The rolled-back contact is gone and the good row minted a fresh one.
    expect(fake.store.contacts).toHaveLength(1);
    expect(fake.store.contacts[0].full_name).toBe('Shared Contact');

    // The surviving ticket points at a contact that actually exists.
    expect(fake.store.tickets).toHaveLength(1);
    expect(fake.store.tickets[0].title).toBe('Good row');
    expect(fake.store.tickets[0].contact_id).toBe(fake.store.contacts[0].contact_name_id);
  });
});
