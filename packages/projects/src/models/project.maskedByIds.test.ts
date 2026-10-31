import knex, { type Knex } from 'knex';
import { describe, expect, it } from 'vitest';

import ProjectModel from './project';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SOURCE = {
  tenant: TENANT, project_id: 'p1', project_name: 'Aurora Rollout', description: 'HIDDEN-DESCRIPTION', budgeted_hours: 120,
  start_date: '2026-05-01T00:00:00.000Z', client_id: 'c1',
};

/** A real knex builder over a fake pg connection that returns one row and records the SQL and bindings. */
function fakeDb(joined: Record<string, unknown>) {
  const sent: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = knex({ client: 'pg' });
  const client = db.client as unknown as Record<string, unknown>;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => {};
  client._query = async (_c: unknown, obj: { sql: string; bindings: unknown[]; response?: unknown }) => {
    sent.push({ sql: obj.sql, bindings: obj.bindings });
    // The SQL merges the JSON overrides over to_jsonb(projects); apply them as the database would.
    const overrides = obj.bindings.map(String).find((binding) => binding.startsWith('{')) ?? '{}';
    const rows = [{ masked: { ...SOURCE, ...JSON.parse(overrides) }, ...joined }];
    obj.response = { rows, rowCount: 1, command: 'SELECT' };
    return obj;
  };
  return { db: db as unknown as Knex, sent };
}

describe('ProjectModel.getMaskedByIds', () => {
  it('nulls hidden columns in the query, neutral-titles a hidden name, and keeps visible data', async () => {
    const { db, sent } = fakeDb({ client_name: null, assigned_to_first_name: 'Pat', assigned_to_last_name: 'Manager', contact_name: 'Jo', status_name: 'Open', is_closed: false });
    const [row] = await ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['description', 'project_name', 'budgeted_hours', 'client_name']);

    expect(row).toMatchObject({ project_id: 'p1', project_name: 'Project', description: null, budgeted_hours: null, client_name: null, contact_name: 'Jo' });
    expect(JSON.stringify(row)).not.toContain('HIDDEN-DESCRIPTION');
    expect(row.start_date).toBeInstanceOf(Date);
    expect(sent[0].sql).toContain('NULL::text as "client_name"');
    expect(sent[0].sql).not.toContain('"clients"."client_name" as');
    expect(sent[0].sql).not.toContain('projects.*');
  });

  it('returns no row when the project or its identifier is hidden', async () => {
    const { db, sent } = fakeDb({});
    await expect(ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['projects'])).resolves.toEqual([]);
    await expect(ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['project_id'])).resolves.toEqual([]);
    await expect(ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['*'])).resolves.toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
