import knex, { type Knex } from 'knex';
import { describe, expect, it } from 'vitest';

import { CO_MANAGED_PROJECT_COLUMNS, coManagedHiddenColumns } from '@alga-psa/co-managed/projectFieldMask';
import ProjectModel, { PROJECT_MASKED_ROW_COLUMNS } from './project';

const TENANT = '11111111-1111-4111-8111-111111111111';

/** A real knex builder over a fake pg connection that records the SQL. */
function fakeDb() {
  const sent: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = knex({ client: 'pg' });
  const client = db.client as unknown as Record<string, unknown>;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => {};
  client._query = async (_c: unknown, obj: { sql: string; bindings: unknown[]; response?: unknown }) => {
    sent.push({ sql: obj.sql, bindings: obj.bindings });
    obj.response = { rows: [], rowCount: 0, command: 'SELECT' };
    return obj;
  };
  return { db: db as unknown as Knex, sent };
}

describe('ProjectModel.getMaskedByIds', () => {
  it('selects an explicit column list: hidden columns are typed NULLs, never the raw column', async () => {
    const { db, sent } = fakeDb();
    await ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['description', 'project_name', 'budgeted_hours', 'client_name', 'billing_profile_id']);
    const sql = sent[0].sql;
    expect(sql).not.toContain('"projects".*');
    expect(sql).not.toContain('to_jsonb');
    expect(sql).toContain('CASE WHEN FALSE THEN "projects"."billing_profile_id" END as "billing_profile_id"');
    expect(sql).toContain('CASE WHEN FALSE THEN "projects"."description" END as "description"');
    expect(sql).toContain('CASE WHEN FALSE THEN "projects"."budgeted_hours" END as "budgeted_hours"');
    expect(sql).toContain('NULL::text as "client_name"');
    expect(sql).toContain('::text as "project_name"');
    expect(sql.split(' from ')[0]).not.toMatch(/"projects"\."(billing_profile_id|description|budgeted_hours)"(?! END)/);
  });

  it('emits a visible column plainly when nothing hides it', async () => {
    const { db, sent } = fakeDb();
    await ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['description']);
    expect(sent[0].sql.split(' from ')[0]).toContain('"projects"."billing_profile_id"');
  });

  it('every emitted projects column passes through the hidden check (fail closed)', () => {
    const structural = ['tenant', 'project_id', 'project_name', 'description'];
    for (const column of PROJECT_MASKED_ROW_COLUMNS) {
      if (structural.includes(column)) continue;
      expect(Object.keys(CO_MANAGED_PROJECT_COLUMNS), `${column} has no redaction alias`).toContain(column);
      // Redacting the column by name hides it.
      expect(coManagedHiddenColumns([column], 'projects', CO_MANAGED_PROJECT_COLUMNS).has(column), column).toBe(true);
    }
    expect(PROJECT_MASKED_ROW_COLUMNS).toContain('billing_profile_id');
  });

  it('returns no row when the project or its identifier is hidden', async () => {
    const { db, sent } = fakeDb();
    await expect(ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['projects'])).resolves.toEqual([]);
    await expect(ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['project_id'])).resolves.toEqual([]);
    await expect(ProjectModel.getMaskedByIds(db, TENANT, ['p1'], ['*'])).resolves.toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
