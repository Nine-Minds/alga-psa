import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';
import { buildRelevanceRequest } from '../../services/smartSearch/scoreBatch';
import { TICKET_RELEVANCE } from '../../services/smartSearch/entities/ticket';

vi.mock('@alga-psa/search/acl', () => ({
  resolveSearchAclPrincipal: vi.fn(async () => ({ userId: 'reader', permissions: ['ticket:read'] })),
  aclPredicateSql: vi.fn(() => ({ sql: 'TRUE', bindings: [] })),
}));

import { loadTicketCandidates } from '../../services/smartSearch/entities/ticket';

const TENANT = '71000000-0000-4000-8000-000000000001';
const IDS = {
  restricted: '71000000-0000-4000-8000-000000000011',
  open: '71000000-0000-4000-8000-000000000012',
  otherMask: '71000000-0000-4000-8000-000000000013',
  wildcard: '71000000-0000-4000-8000-000000000014',
};

describe('ticket smart-search SQL redaction', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('projects mixed redaction groups in SQL and never queries comments for a redacted ticket', async () => {
    const trx = await db.transaction();
    const queries: Array<{ sql: string; bindings: unknown[] }> = [];
    trx.on('query', (query: { sql: string; bindings: unknown[] }) => queries.push(query));
    try {
      await trx.raw(`
        CREATE TEMP TABLE tickets (
          tenant uuid, ticket_id uuid, ticket_number text, title text, attributes jsonb,
          client_id uuid, status_id uuid, priority_id uuid, board_id uuid, assigned_to uuid,
          assigned_team_id uuid, entered_at timestamptz, updated_at timestamptz,
          closed_at timestamptz, due_date timestamptz
        ) ON COMMIT DROP;
        CREATE TEMP TABLE clients (tenant uuid, client_id uuid, client_name text) ON COMMIT DROP;
        CREATE TEMP TABLE statuses (tenant uuid, status_id uuid, name text, is_closed boolean) ON COMMIT DROP;
        CREATE TEMP TABLE priorities (tenant uuid, priority_id uuid, item_type text, priority_name text) ON COMMIT DROP;
        CREATE TEMP TABLE boards (tenant uuid, board_id uuid, board_name text) ON COMMIT DROP;
        CREATE TEMP TABLE users (tenant uuid, user_id uuid, first_name text, last_name text) ON COMMIT DROP;
        CREATE TEMP TABLE teams (tenant uuid, team_id uuid, team_name text) ON COMMIT DROP;
        CREATE TEMP TABLE app_search_index (
          tenant uuid, object_type text, parent_id uuid, body text, metadata jsonb, source_updated_at timestamptz
        ) ON COMMIT DROP;
      `);
      const boardId = '71000000-0000-4000-8000-000000000021';
      const clientId = '71000000-0000-4000-8000-000000000022';
      const statusId = '71000000-0000-4000-8000-000000000023';
      const priorityId = '71000000-0000-4000-8000-000000000024';
      const assigneeId = '71000000-0000-4000-8000-000000000025';
      const teamId = '71000000-0000-4000-8000-000000000026';
      await trx('clients').insert({ tenant: TENANT, client_id: clientId, client_name: 'SECRET CLIENT' });
      await trx('statuses').insert({ tenant: TENANT, status_id: statusId, name: 'SECRET STATUS', is_closed: false });
      await trx('priorities').insert({ tenant: TENANT, priority_id: priorityId, item_type: 'ticket', priority_name: 'SECRET PRIORITY' });
      await trx('boards').insert({ tenant: TENANT, board_id: boardId, board_name: 'SECRET BOARD' });
      await trx('users').insert({ tenant: TENANT, user_id: assigneeId, first_name: 'SECRET', last_name: 'ASSIGNEE' });
      await trx('teams').insert({ tenant: TENANT, team_id: teamId, team_name: 'SECRET TEAM' });
      await trx('tickets').insert([
        { tenant: TENANT, ticket_id: IDS.restricted, ticket_number: 'SECRET-NUMBER', title: 'SECRET TITLE', attributes: { description: 'SECRET DESCRIPTION', custom_private: 'SECRET ATTRIBUTE' }, client_id: clientId, status_id: statusId, priority_id: priorityId, board_id: boardId, assigned_to: assigneeId, assigned_team_id: teamId, due_date: new Date('2026-02-01T00:00:00Z') },
        { tenant: TENANT, ticket_id: IDS.open, ticket_number: 'T-OPEN', title: 'Visible title', attributes: { description: 'Visible description' }, client_id: clientId, status_id: statusId, priority_id: priorityId, board_id: boardId, assigned_to: assigneeId, assigned_team_id: teamId },
        { tenant: TENANT, ticket_id: IDS.otherMask, ticket_number: 'SECRET-OTHER-NUMBER', title: 'SECRET OTHER TITLE', attributes: { description: 'SECRET OTHER DESCRIPTION' }, client_id: clientId, status_id: statusId, priority_id: priorityId, board_id: boardId, assigned_to: assigneeId, assigned_team_id: teamId },
        { tenant: TENANT, ticket_id: IDS.wildcard, ticket_number: 'SECRET-WILDCARD-NUMBER', title: 'SECRET WILDCARD TITLE', attributes: { description: 'SECRET WILDCARD DESCRIPTION' }, client_id: clientId, status_id: statusId, priority_id: priorityId, board_id: boardId, assigned_to: assigneeId, assigned_team_id: teamId },
      ]);
      await trx('app_search_index').insert([
        { tenant: TENANT, object_type: 'ticket_comment', parent_id: IDS.restricted, body: 'SECRET RESTRICTED COMMENT', metadata: { author_kind: 'technician' }, source_updated_at: new Date('2026-01-04T00:00:00Z') },
        { tenant: TENANT, object_type: 'ticket_comment', parent_id: IDS.open, body: 'Visible comment', metadata: { author_kind: 'technician' }, source_updated_at: new Date('2026-01-03T00:00:00Z') },
        { tenant: TENANT, object_type: 'ticket_comment', parent_id: IDS.otherMask, body: 'SECRET OTHER COMMENT', metadata: { author_kind: 'client' }, source_updated_at: new Date('2026-01-02T00:00:00Z') },
        { tenant: TENANT, object_type: 'ticket_comment', parent_id: IDS.wildcard, body: 'SECRET WILDCARD COMMENT', metadata: { author_kind: 'client' }, source_updated_at: new Date('2026-01-01T00:00:00Z') },
      ]);

      const candidates = await loadTicketCandidates(
        trx,
        TENANT,
        { user_id: 'reader', user_type: 'internal' } as any,
        [IDS.restricted, IDS.open, IDS.otherMask, IDS.wildcard, '71000000-0000-4000-8000-000000000099'],
        new Map([
          [IDS.restricted, ['title', 'ticket_number', 'description', 'client_name', 'assigned_to', 'due_date', 'attributes.custom_private']],
          [IDS.open, []],
          [IDS.otherMask, ['board_name']],
          [IDS.wildcard, ['*']],
        ])
      );

      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const scorerRequest = buildRelevanceRequest(
        TICKET_RELEVANCE,
        'find restricted fixture',
        candidates.filter((candidate) => candidate.id === IDS.restricted)
      );
      expect(byId.has(IDS.wildcard)).toBe(false);
      expect(byId.has('71000000-0000-4000-8000-000000000099')).toBe(false);
      expect(JSON.stringify(scorerRequest.state.candidates)).not.toMatch(/SECRET (?:NUMBER|TITLE|DESCRIPTION|CLIENT|ASSIGNEE|OTHER|WILDCARD)/);
      const restrictedState = byId.get(IDS.restricted)?.state;
      expect(restrictedState).toMatchObject({
        ticket_number: '',
        title: 'Restricted ticket',
        client: null,
        assigned_to: null,
        due_date: null,
        description: '',
        comments: [],
      });
      expect(JSON.stringify(restrictedState)).not.toMatch(/SECRET (?:NUMBER|TITLE|DESCRIPTION|CLIENT|ASSIGNEE|OTHER|WILDCARD)/);
      expect(JSON.stringify(byId.get(IDS.otherMask)?.state)).not.toContain('SECRET BOARD');
      expect(byId.get(IDS.open)?.state).toMatchObject({ title: 'Visible title', description: 'Visible description' });
      expect(byId.get(IDS.open)?.state.comments).toEqual([{ author: 'technician', text: 'Visible comment' }]);

      const commentQuery = queries.find((query) => /app_search_index/i.test(query.sql) && /row_number/i.test(query.sql));
      expect(commentQuery).toBeDefined();
      expect(commentQuery?.bindings).toContain(IDS.open);
      expect(commentQuery?.bindings).not.toContain(IDS.restricted);
      expect(commentQuery?.bindings).not.toContain(IDS.otherMask);
      expect(commentQuery?.bindings).not.toContain(IDS.wildcard);
    } finally {
      await trx.rollback();
    }
  });
});
