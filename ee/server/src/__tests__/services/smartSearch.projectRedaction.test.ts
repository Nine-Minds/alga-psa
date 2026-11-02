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

beforeEach(() => {
  vi.resetAllMocks();
  mocks.served.mockResolvedValue({ served: true });
  mocks.coManagedWorkspace.mockResolvedValue(true);
});

describe('project smart search candidate loading for a redacted co-managed reader', () => {
  it('builds the candidate from the masked projection: hidden fields are NULL in the query, the title neutral, no comments', async () => {
    const { db, queries } = fakeDb();
    const [candidate] = await loadProjectCandidates(db, TENANT, user, [PROJECT], new Map([[PROJECT, HIDDEN]]));
    const json = JSON.stringify(candidate.state);

    for (const secret of ['HIDDEN-PROJECT-DESCRIPTION', 'HIDDEN-TASK-NAME', 'HIDDEN-TASK-DESCRIPTION', 'HIDDEN-CLIENT', 'HIDDEN-COMMENT-TEXT']) {
      expect(json).not.toContain(secret);
    }
    expect(candidate.state.description).toBe('');
    expect(candidate.state.client).toBeNull();
    expect(candidate.state.tasks).toEqual([expect.objectContaining({ task: 'Project task', text: '', phase: 'Phase One' })]);
    // Visible data still flows.
    expect(candidate.state).toMatchObject({ project_name: 'Aurora Rollout', contact: 'Visible Contact', project_manager: 'Visible Manager' });
    // The hidden columns never left SQL, and the comment index was never read.
    expect(queries.join('\n')).not.toContain('p."description"');
    expect(queries.join('\n')).not.toContain('pt."task_name"');
    expect(queries.some((sql) => /app_search_index/.test(sql))).toBe(false);
  });

  it('shows the neutral title when the project title is hidden', async () => {
    const { db } = fakeDb();
    const [candidate] = await loadProjectCandidates(db, TENANT, user, [PROJECT], new Map([[PROJECT, ['project_name']]]));
    expect(candidate.state.project_name).toBe('Project');
    expect(JSON.stringify(candidate.state)).not.toContain('Aurora Rollout');
  });

  it.each([
    ['the whole project resource', ['projects']],
    ['the project identifier', ['project_id']],
    ['everything', ['*']],
  ])('drops the candidate when %s is hidden', async (_label, redactions) => {
    const { db } = fakeDb();
    await expect(loadProjectCandidates(db, TENANT, user, [PROJECT], new Map([[PROJECT, redactions]]))).resolves.toEqual([]);
  });

  it('drops the tasks, keeping the project, when the task resource is hidden', async () => {
    const { db } = fakeDb();
    const [candidate] = await loadProjectCandidates(db, TENANT, user, [PROJECT], new Map([[PROJECT, ['project_tasks']]]));
    expect(candidate.state.tasks).toEqual([]);
  });

  it('leaves comments out for a co-managed reader even with no redactions, and reads them for a native tenant', async () => {
    const coManaged = fakeDb();
    const [withoutComments] = await loadProjectCandidates(coManaged.db, TENANT, user, [PROJECT], new Map());
    expect(withoutComments.state.comments).toEqual([]);
    expect(coManaged.queries.some((sql) => /app_search_index/.test(sql))).toBe(false);

    mocks.served.mockResolvedValue({ served: false });
    const native = fakeDb();
    const [nativeCandidate] = await loadProjectCandidates(native.db, TENANT, user, [PROJECT], new Map());
    expect(nativeCandidate.state.comments).toEqual([{ task: 'HIDDEN-TASK-NAME', text: 'HIDDEN-COMMENT-TEXT' }]);
  });

  it('a native tenant keeps every field, task and comment unchanged', async () => {
    mocks.coManagedWorkspace.mockResolvedValue(false);
    const { db } = fakeDb();
    const [candidate] = await loadProjectCandidates(db, TENANT, user, [PROJECT], new Map());
    expect(candidate.state).toMatchObject({
      project_number: 'PRJ-0042', project_name: 'Aurora Rollout', client: 'HIDDEN-CLIENT', contact: 'Visible Contact',
      description: 'HIDDEN-PROJECT-DESCRIPTION', budgeted_hours: 120,
    });
    expect(candidate.state.tasks).toEqual([expect.objectContaining({ task: 'HIDDEN-TASK-NAME', text: 'HIDDEN-TASK-DESCRIPTION' })]);
    expect(candidate.state.comments).toEqual([{ task: 'HIDDEN-TASK-NAME', text: 'HIDDEN-COMMENT-TEXT' }]);
  });
});

describe('project smart search definition carries the redaction set', () => {
  it('enumerates targets with their redaction sets', async () => {
    mocks.authorizeProjectIdsWithRedactions.mockResolvedValue([{ projectId: 'a', redactedFields: ['description'] }, { projectId: 'b', redactedFields: [] }]);
    await expect(projectSmartSearch.enumerate({ projectIds: ['a', 'b'] })).resolves.toEqual([
      { id: 'a', redactedFields: ['description'] },
      { id: 'b', redactedFields: [] },
    ]);
    expect(mocks.authorizeProjectIdsWithRedactions).toHaveBeenCalledWith(['a', 'b']);
  });

  it('passes an enumeration failure through unchanged', async () => {
    const failure = { permissionError: 'Permission denied: nope' };
    mocks.authorizeProjectIdsWithRedactions.mockResolvedValue(failure);
    await expect(projectSmartSearch.enumerate({ projectIds: ['a'] })).resolves.toBe(failure);
  });

  it('hands only the redactions of the requested ids to the hydration loader', async () => {
    mocks.loadProjectListItemsByIds.mockResolvedValue({ projects: [], metadata: { projectTags: {} } });
    await projectSmartSearch.hydrateRows({ projectIds: ['a', 'b'] }, ['a', 'b'], new Map([['a', ['description']], ['z', ['x']]]));
    expect(mocks.loadProjectListItemsByIds).toHaveBeenCalledWith(['a', 'b'], { a: ['description'] });
  });
});

describe('runSmartSearch end to end for a redacted co-managed reader', () => {
  it('sends the scorer no hidden value or comment text, and hydrates with the same redactions', async () => {
    const { raw } = fakeDb();
    mocks.fakeKnex.current = raw;
    mocks.authorizeProjectIdsWithRedactions.mockResolvedValue([{ projectId: PROJECT, redactedFields: HIDDEN }]);
    mocks.systemOne.mockResolvedValue({ model: 'jev', answers: { c0: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 0 } });
    mocks.loadProjectListItemsByIds.mockResolvedValue({
      projects: [{ project_id: PROJECT, project_name: 'Aurora Rollout', description: null }], metadata: { projectTags: {} },
    });

    const events = [];
    for await (const event of runSmartSearch({
      definition: projectSmartSearch, tenant: TENANT, user, scope: { projectIds: [PROJECT] }, query: 'rollout',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(mocks.systemOne).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(mocks.systemOne.mock.calls[0][0]);
    for (const secret of ['HIDDEN-PROJECT-DESCRIPTION', 'HIDDEN-TASK-NAME', 'HIDDEN-TASK-DESCRIPTION', 'HIDDEN-CLIENT', 'HIDDEN-COMMENT-TEXT']) {
      expect(prompt).not.toContain(secret);
    }
    expect(prompt).toContain('Aurora Rollout');
    expect(mocks.loadProjectListItemsByIds).toHaveBeenCalledWith([PROJECT], { [PROJECT]: HIDDEN });
    const streamed = JSON.stringify(events);
    for (const secret of ['HIDDEN-PROJECT-DESCRIPTION', 'HIDDEN-CLIENT', 'HIDDEN-COMMENT-TEXT']) {
      expect(streamed).not.toContain(secret);
    }
    expect(events.map((event) => event.type)).toEqual(['started', 'scored', 'done']);
  });

  it('reports a hidden project as unscored instead of sending anything', async () => {
    const { raw } = fakeDb();
    mocks.fakeKnex.current = raw;
    mocks.authorizeProjectIdsWithRedactions.mockResolvedValue([{ projectId: PROJECT, redactedFields: ['projects'] }]);
    const events = [];
    for await (const event of runSmartSearch({
      definition: projectSmartSearch, tenant: TENANT, user, scope: { projectIds: [PROJECT] }, query: 'rollout',
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }
    expect(mocks.systemOne).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['started', 'batch_failed', 'done']);
  });
});
