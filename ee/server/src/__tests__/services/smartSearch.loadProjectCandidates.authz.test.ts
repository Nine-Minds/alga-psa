import knex, { type Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeProjectIdsWithRedactions: vi.fn(),
  loadProjectListItemsByIds: vi.fn(),
  served: vi.fn(),
  coManagedWorkspace: vi.fn(),
  systemOne: vi.fn(),
  fakeKnex: { current: null as unknown },
}));

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  authorizeProjectIdsWithRedactions: mocks.authorizeProjectIdsWithRedactions,
  loadProjectListItemsByIds: mocks.loadProjectListItemsByIds,
}));
vi.mock('@alga-psa/search/acl', () => ({
  aclPredicateSql: () => ({ sql: 'true', bindings: [] }),
  resolveSearchAclPrincipal: async () => ({}),
}));
vi.mock('@alga-psa/core/capability', () => ({ serves: mocks.served }));
vi.mock('@alga-psa/co-managed/coManagedWorkspace', () => ({ isCoManagedWorkspace: mocks.coManagedWorkspace }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/smartSearch/typesafeClient', () => ({
  resolveTypeSafeClient: async () => ({ systemOne: mocks.systemOne }),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  createTenantKnex: async () => ({ knex: mocks.fakeKnex.current }),
  withTransaction: async (db: unknown, fn: (trx: unknown) => Promise<unknown>) => fn(db),
}));

import { loadProjectCandidates, projectSmartSearch } from '../../services/smartSearch/entities/project';
import { runSmartSearch } from '../../services/smartSearch/runSmartSearch';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const user = { user_id: 'u1', tenant: TENANT, user_type: 'internal' } as never;

const SOURCE = {
  project: {
    project_id: PROJECT, project_number: 'PRJ-0042', project_name: 'Aurora Rollout', description: 'HIDDEN-PROJECT-DESCRIPTION',
    client_name: 'HIDDEN-CLIENT', contact_name: 'Visible Contact', status_name: 'In Progress', is_closed: false, is_inactive: false,
    manager_name: 'Visible Manager', start_date: '2026-05-01T00:00:00.000Z', end_date: '2026-06-30T00:00:00.000Z',
    created_at: '2026-04-01T09:00:00.000Z', updated_at: '2026-05-20T09:00:00.000Z', budgeted_hours: '120',
  },
  task: {
    project_id: PROJECT, phase_name: 'Phase One', task_name: 'HIDDEN-TASK-NAME', description: 'HIDDEN-TASK-DESCRIPTION',
    status_name: 'To Do', is_closed: false, priority_name: 'High', assigned_to_name: 'Visible Tech',
    due_date: '2026-06-01T00:00:00.000Z', updated_at: '2026-05-20T09:00:00.000Z',
  },
  comment: { project_id: PROJECT, task_name: 'HIDDEN-TASK-NAME', body: 'HIDDEN-COMMENT-TEXT', source_updated_at: '2026-05-21T09:00:00.000Z' },
};

/**
 * A real knex query builder over a fake pg connection. It "executes" the SQL the loaders generate by
 * interpreting the select list: an output alias projected as `NULL::<type> as alias` comes back null, a
 * bound neutral title comes back as the bound text, everything else comes back as the stored value. So a
 * column the SQL does not mask is returned, and the tests see exactly what the database would hand back.
 */
function fakeDb() {
  const queries: string[] = [];
  const db = knex({ client: 'pg' });
  const client = db.client as unknown as Record<string, unknown>;
  const interpret = (sql: string, bindings: unknown[], source: Record<string, unknown>) => {
    const row: Record<string, unknown> = {};
    for (const [alias, value] of Object.entries(source)) {
      if (new RegExp(`NULL::\\w+ as "?${alias}"?[ ,)]`).test(sql)) row[alias] = null;
      else if (new RegExp(`\\$(\\d+)::text as "?${alias}"?[ ,)]`).test(sql)) {
        const index = Number(new RegExp(`\\$(\\d+)::text as "?${alias}"?[ ,)]`).exec(sql)![1]);
        row[alias] = bindings[index - 1];
      } else row[alias] = value;
    }
    return row;
  };
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => {};
  client._query = async (_connection: unknown, obj: { sql: string; bindings: unknown[]; response?: unknown }) => {
    queries.push(obj.sql);
    let rows: unknown[] = [];
    if (/from "projects" as "p"/.test(obj.sql)) rows = [interpret(obj.sql, obj.bindings, SOURCE.project)];
    else if (/"project_tasks" as "pt"/.test(obj.sql) && !/app_search_index/.test(obj.sql)) rows = [interpret(obj.sql, obj.bindings, SOURCE.task)];
    else if (/app_search_index/.test(obj.sql)) rows = [SOURCE.comment];
    obj.response = { rows, rowCount: rows.length, command: 'SELECT' };
    return obj;
  };
  return { db: db as unknown as Knex.Transaction, queries, raw: db };
}

const HIDDEN = ['description', 'project_tasks.task_name', 'project_tasks.description', 'client_name'];
const SECRETS = ['HIDDEN-PROJECT-DESCRIPTION', 'HIDDEN-TASK-NAME', 'HIDDEN-TASK-DESCRIPTION', 'HIDDEN-CLIENT', 'HIDDEN-COMMENT-TEXT'];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.served.mockResolvedValue({ served: true });
  mocks.coManagedWorkspace.mockResolvedValue(true);
});

/**
 * Regression for security finding "authz in loadProjectCandidates"
 * (fingerprint ee/server/src/services/smartSearch/entities/project.ts#loadProjectCandidates),
 * a duplicate of card 620a1cf4. Before the fix the candidate was built from unmasked project/task/comment
 * reads, so redacted values reached the scorer and the SSE rows.
 */
describe('security: authz in loadProjectCandidates (ee/server/src/services/smartSearch/entities/project.ts#loadProjectCandidates)', () => {
  it('a co-managed reader whose decision carries redactedFields gets no redacted value or comment body in the candidate', async () => {
    const { db, queries } = fakeDb();
    const candidates = await loadProjectCandidates(db, TENANT, user, [PROJECT], new Map([[PROJECT, HIDDEN]]));
    expect(candidates).toHaveLength(1);
    const everything = JSON.stringify(candidates);
    for (const secret of SECRETS) {
      expect(everything).not.toContain(secret);
    }
    expect(queries.some((sql) => /app_search_index/.test(sql))).toBe(false);
  });

  it('omits comments for a reader with any redaction even when the workspace is not co-managed', async () => {
    mocks.coManagedWorkspace.mockResolvedValue(false);
    const { db, queries } = fakeDb();
    const [candidate] = await loadProjectCandidates(db, TENANT, user, [PROJECT], new Map([[PROJECT, ['description']]]));
    expect(candidate.state.comments).toEqual([]);
    expect(JSON.stringify(candidate)).not.toContain('HIDDEN-COMMENT-TEXT');
    expect(queries.some((sql) => /app_search_index/.test(sql))).toBe(false);
  });

  it('the scorer prompt and the SSE rows contain no redacted field', async () => {
    const { raw } = fakeDb();
    mocks.fakeKnex.current = raw;
    mocks.authorizeProjectIdsWithRedactions.mockResolvedValue([{ projectId: PROJECT, redactedFields: HIDDEN }]);
    mocks.systemOne.mockResolvedValue({ model: 'jev', answers: { c0: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 0 } });
    // Stand-in for the masked by-ids hydration: nulls whatever the caller's redaction set names.
    mocks.loadProjectListItemsByIds.mockImplementation(async (ids: string[], redactions: Record<string, string[]> = {}) => ({
      projects: ids.map((id) => ({
        project_id: id,
        project_name: 'Aurora Rollout',
        description: redactions[id]?.includes('description') ? null : 'HIDDEN-PROJECT-DESCRIPTION',
        client_name: redactions[id]?.includes('client_name') ? null : 'HIDDEN-CLIENT',
      })),
      metadata: { projectTags: {} },
    }));

    const events = [];
    for await (const event of runSmartSearch({
      definition: projectSmartSearch, tenant: TENANT, user, scope: { projectIds: [PROJECT] }, query: 'rollout',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    const prompt = JSON.stringify(mocks.systemOne.mock.calls[0][0]);
    const streamed = JSON.stringify(events);
    for (const secret of SECRETS) {
      expect(prompt).not.toContain(secret);
      expect(streamed).not.toContain(secret);
    }
    expect(mocks.loadProjectListItemsByIds).toHaveBeenCalledWith([PROJECT], { [PROJECT]: HIDDEN });
    expect(events.map((event) => event.type)).toEqual(['started', 'scored', 'done']);
  });
});
