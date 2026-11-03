import knex, { type Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getIds: vi.fn(), authorize: vi.fn(), hydrate: vi.fn(), score: vi.fn(), currentDb: { current: null as unknown }, lastSql: { value: '' },
}));

vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({
  getAllMatchingTicketIds: mocks.getIds,
  authorizeTicketIdsWithRedactions: mocks.authorize,
  loadTicketListItemsByIds: mocks.hydrate,
}));
vi.mock('@alga-psa/search/acl', () => ({
  aclPredicateSql: () => ({ sql: 'true', bindings: [] }),
  resolveSearchAclPrincipal: async () => ({}),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, _tenant: string) => ({
    table: (name: string) => (mocks.currentDb.current as Knex).table(name),
    tenantJoin: (query: Knex.QueryBuilder, table: string, left: string, right: string, options?: { type?: string }) => {
      (options?.type === 'left' ? query.leftJoin.bind(query) : query.join.bind(query))(table, left, right);
    },
  }),
  createTenantKnex: async () => ({ knex: mocks.currentDb.current }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(mocks.currentDb.current),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/smartSearch/typesafeClient', () => ({ resolveTypeSafeClient: async () => ({ systemOne: mocks.score }) }));

import { ticketSmartSearch } from '../../services/smartSearch/entities/ticket';
import { runSmartSearch } from '../../services/smartSearch/runSmartSearch';
import { hiddenTicketFields } from '@alga-psa/tickets/lib/ticketFieldProjection';

const TENANT = '11111111-1111-4111-8111-111111111111';
const TICKET = '22222222-2222-4222-8222-222222222222';
const user = { user_id: 'u1', tenant: TENANT, user_type: 'internal' } as never;
const hiddenValues = {
  ticket_id: TICKET, ticket_number: 'T-9', title: 'SECRET-TITLE', description: 'SECRET-DESCRIPTION',
  client_name: 'SECRET-CLIENT', assigned_to_name: 'SECRET-ASSIGNEE', assigned_team_name: 'Visible Team',
  status_name: 'Open', is_closed: false, priority_name: 'High', board_name: 'Board',
  entered_at: null, updated_at: null, closed_at: null, due_date: null,
};

function fakeDatabase() {
  const db = knex({ client: 'pg' });
  const client = db.client as unknown as Record<string, unknown>;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => {};
  client._query = async (_connection: unknown, query: { sql: string; response?: unknown }) => {
    mocks.lastSql.value = query.sql;
    const row = { ...hiddenValues };
    for (const [field, value] of Object.entries(row)) {
      const nullProjection = new RegExp(`NULL::\\w+ as "?${field}"?[ ,)]`).test(query.sql);
      const neutralTitle = /'Hidden ticket'::text as "?title"?/.test(query.sql);
      if (nullProjection) (row as Record<string, unknown>)[field] = null;
      else if (field === 'title' && neutralTitle) (row as Record<string, unknown>)[field] = 'Hidden ticket';
    }
    query.response = { rows: /from "tickets" as "t"/.test(query.sql) ? [row] : [], rowCount: 1, command: 'SELECT' };
    return query;
  };
  return db;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentDb.current = fakeDatabase();
  mocks.getIds.mockResolvedValue([TICKET]);
  mocks.authorize.mockResolvedValue([{ ticketId: TICKET, redactedFields: ['tickets.client_id', 'assigned_to', 'attributes', 'title'] }]);
  mocks.hydrate.mockResolvedValue({ tickets: [{ ticket_id: TICKET }], metadata: { agentAvatarUrls: {}, teamAvatarUrls: {}, ticketTags: {} } });
  mocks.score.mockResolvedValue({ model: 'jev', answers: { c0: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1 } });
});

describe('ticket smart search authorization projection', () => {
  it('executes SQL masking before candidate assembly and never sends hidden aliases or comments to the scorer', async () => {
    expect([...hiddenTicketFields(['tickets.client_id', 'assigned_to', 'attributes', 'title'])]).toEqual(expect.arrayContaining(['client_id', 'assigned_to', 'attributes', 'description', 'title']));
    const frames = [];
    for await (const frame of runSmartSearch({
      definition: ticketSmartSearch, tenant: TENANT, user,
      scope: { searchQuery: '', boardFilterState: 'all' } as never, query: 'secret', signal: new AbortController().signal,
    })) frames.push(frame);
    const scorerInput = JSON.stringify(mocks.score.mock.calls[0][0]);
    for (const secret of ['SECRET-TITLE', 'SECRET-DESCRIPTION', 'SECRET-CLIENT', 'SECRET-ASSIGNEE']) {
      expect(scorerInput, mocks.lastSql.value).not.toContain(secret);
    }
    expect(scorerInput).toContain('Hidden ticket');
    expect(scorerInput).toContain('Visible Team');
    expect(frames.map(({ type }) => type)).toEqual(['started', 'scored', 'done']);
  });

  it('does not load ticket candidates for an absent per-target authorization decision', async () => {
    const { loadTicketCandidates } = await import('../../services/smartSearch/entities/ticket');
    const candidate = await loadTicketCandidates(mocks.currentDb.current as Knex.Transaction, TENANT, user, [TICKET], new Map());
    expect(candidate).toEqual([]);
  });
});
