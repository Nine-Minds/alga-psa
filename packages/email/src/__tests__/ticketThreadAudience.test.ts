import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  failTable: null as string | null,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/db', () => {
  function makeBuilder(table: string) {
    let rows = (state.tables[table] ?? []).slice();
    const builder: any = {
      select: () => builder,
      where: (criteria: Row) => {
        rows = rows.filter((row) =>
          Object.entries(criteria).every(([key, value]) => key === 'tenant' || row[key] === value)
        );
        return builder;
      },
      whereIn: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      // Only used for users: 'lower(email) = ANY(?)'
      whereRaw: (_sql: string, [values]: [string[]]) => {
        rows = rows.filter((row) => values.includes(String(row.email).toLowerCase()));
        return builder;
      },
      first: async () => rows[0],
      update: async () => 1,
      then: (resolve: any, reject: any) => {
        if (state.failTable === table) return Promise.reject(new Error(`boom ${table}`)).then(resolve, reject);
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return builder;
  }
  return {
    createTenantKnex: vi.fn(async () => ({ knex: { raw: vi.fn() } })),
    tenantDb: () => ({ table: (table: string) => makeBuilder(table) }),
  };
});

import { applyTicketThreadHeaders } from '../BaseEmailService';

const ROOT = '<root@customer.example>';
const PUBLIC_ID = '<public@alga.example>';
const NOTE_ID = '<internal-note@alga.example>';
const ASSIGN_ID = '<internal-assign@alga.example>';
const INBOUND_ID = '<inbound@customer.example>';

async function run(
  references: string[],
  recipients?: { to?: string[]; cc?: string[]; bcc?: string[] }
) {
  state.tables.tickets = [{ ticket_id: 't1', email_metadata: { messageId: ROOT, references } }];
  const headers: Record<string, string> = {};
  await applyTicketThreadHeaders({
    tenantId: 'tenant-1',
    ticketId: 't1',
    headers,
    serviceName: 'Test',
    recipients,
  });
  return headers;
}

const CHAIN = [PUBLIC_ID, NOTE_ID, ASSIGN_ID];

describe('applyTicketThreadHeaders audience filtering', () => {
  beforeEach(() => {
    state.failTable = null;
    state.tables = {
      users: [
        { email: 'Agent@MSP.example', user_type: 'internal' },
        { email: 'agent2@msp.example', user_type: 'internal' },
        { email: 'portal@customer.example', user_type: 'client' },
      ],
      comments: [
        { comment_id: 'c-public', is_internal: false },
        { comment_id: 'c-note', is_internal: true },
      ],
      comment_threads: [{ thread_id: 'th-public', is_internal: false }],
      email_sending_logs: [
        {
          rfc_message_id: PUBLIC_ID,
          comment_id: 'c-public',
          comment_thread_id: 'th-public',
          to_addresses: ['ada@customer.example', 'agent@msp.example'],
        },
        {
          rfc_message_id: NOTE_ID,
          comment_id: 'c-note',
          comment_thread_id: null,
          to_addresses: ['ada@customer.example'], // recipients alone would not hide it
        },
        {
          rfc_message_id: ASSIGN_ID,
          comment_id: null,
          comment_thread_id: null,
          to_addresses: JSON.stringify(['agent@msp.example']),
          cc_addresses: ['agent2@msp.example'],
        },
      ],
    };
  });

  it('drops internal-only ids for a contact recipient', async () => {
    const headers = await run(CHAIN, { to: ['ada@customer.example'] });
    expect(headers['In-Reply-To']).toBe(PUBLIC_ID);
    expect(headers.References).toBe(`${ROOT} ${PUBLIC_ID}`);
  });

  it('keeps the full chain for internal-only recipients (case-insensitive match)', async () => {
    const headers = await run(CHAIN, { to: ['AGENT@msp.example'], cc: ['agent2@msp.example'] });
    expect(headers['In-Reply-To']).toBe(ASSIGN_ID);
    expect(headers.References).toBe([ROOT, ...CHAIN].join(' '));
  });

  it('filters when a contact is only in cc', async () => {
    const headers = await run(CHAIN, { to: ['agent@msp.example'], cc: ['ada@customer.example'] });
    expect(headers['In-Reply-To']).toBe(PUBLIC_ID);
    expect(headers.References).not.toContain(NOTE_ID);
    expect(headers.References).not.toContain(ASSIGN_ID);
  });

  it('filters when a contact is only in bcc', async () => {
    const headers = await run(CHAIN, { to: ['agent@msp.example'], bcc: ['ada@customer.example'] });
    expect(headers.References).toBe(`${ROOT} ${PUBLIC_ID}`);
  });

  it('treats a client-type user as external', async () => {
    const headers = await run(CHAIN, { to: ['portal@customer.example'] });
    expect(headers['In-Reply-To']).toBe(PUBLIC_ID);
  });

  it('treats omitted recipients as external', async () => {
    const headers = await run(CHAIN);
    expect(headers['In-Reply-To']).toBe(PUBLIC_ID);
    expect(headers.References).toBe(`${ROOT} ${PUBLIC_ID}`);
  });

  it('falls back to the root when only internal ids remain in the chain', async () => {
    const headers = await run([NOTE_ID, ASSIGN_ID], { to: ['ada@customer.example'] });
    expect(headers['In-Reply-To']).toBe(ROOT);
    expect(headers.References).toBe(ROOT);
  });

  it('keeps ids with no email_sending_logs row (inbound / legacy)', async () => {
    const headers = await run([INBOUND_ID, NOTE_ID, PUBLIC_ID], { to: ['ada@customer.example'] });
    expect(headers.References).toBe(`${ROOT} ${INBOUND_ID} ${PUBLIC_ID}`);
    expect(headers['In-Reply-To']).toBe(PUBLIC_ID);
  });

  it('uses root-only headers when the filtering lookup fails', async () => {
    state.failTable = 'email_sending_logs';
    const headers = await run(CHAIN, { to: ['ada@customer.example'] });
    expect(headers['In-Reply-To']).toBe(ROOT);
    expect(headers.References).toBe(ROOT);
  });

  it('uses root-only headers when the recipient classification lookup fails', async () => {
    state.failTable = 'users';
    const headers = await run(CHAIN, { to: ['ada@customer.example'] });
    expect(headers.References).toBe(ROOT);
  });
});
