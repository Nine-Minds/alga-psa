import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tenant: 'tenant-a',
  rows: {} as Record<string, Row[]>,
  tenantDbCalls: [] as string[],
  authorizedProjects: [] as Array<{ tenant: string; projectId: string }>,
}));

function baseTable(tableName: string): string {
  return tableName.split(/\s+as\s+/i)[0];
}

function columnName(column: string): string {
  const withoutAlias = column.split(/\s+as\s+/i)[0];
  return withoutAlias.split('.').at(-1) ?? withoutAlias;
}

function makeQuery(tableName: string, tenant: string) {
  const table = baseTable(tableName);
  const sourceRows = state.rows[table] ?? [];
  let selectedRows = sourceRows.filter((row) => row.tenant === tenant);
  let countByPhase = false;
  const query = {
    where(criteria: Record<string, unknown>) {
      selectedRows = selectedRows.filter((row) =>
        Object.entries(criteria).every(([column, value]) => row[columnName(column)] === value)
      );
      return query;
    },
    whereNotNull(column: string) {
      selectedRows = selectedRows.filter((row) => row[columnName(column)] != null);
      return query;
    },
    whereNull(column: string) {
      selectedRows = selectedRows.filter((row) => row[columnName(column)] == null);
      return query;
    },
    distinct() { return query; },
    groupBy() { return query; },
    orderBy() { return query; },
    select() { return query; },
    count() {
      countByPhase = true;
      return query;
    },
    async first() {
      return selectedRows[0] ?? undefined;
    },
    async update(values: Row) {
      selectedRows.forEach((row) => Object.assign(row, values));
      return selectedRows.length;
    },
    async del() {
      const selected = new Set(selectedRows);
      state.rows[table] = sourceRows.filter((row) => !selected.has(row));
      return selected.size;
    },
    then(resolve: (value: Row[]) => unknown, reject: (reason: unknown) => unknown) {
      const result = countByPhase
        ? Array.from(
            selectedRows.reduce((counts, row) => {
              const phaseId = String(row.phase_id);
              counts.set(phaseId, (counts.get(phaseId) ?? 0) + 1);
              return counts;
            }, new Map<string, number>()),
            ([phase_id, count]) => ({ phase_id, count }),
          )
        : selectedRows;
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => unknown) => (...args: any[]) =>
    action({ user_id: 'user-a', user_type: 'internal', roles: ['role-a'] }, { tenant: state.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, work: (trx: unknown) => unknown) => work({}),
  tenantDb: (_conn: unknown, tenant: string) => {
    state.tenantDbCalls.push(tenant);
    return {
      table: (name: string) => makeQuery(name, tenant),
      tenantJoin: () => undefined,
    };
  },
}));

vi.mock('@alga-psa/projects/models/project', () => ({
  default: {},
  statusMappingSemanticKey: () => null,
}));

vi.mock('../lib/projectReadAuthorization', () => ({
  assertProjectReadAllowed: async (_conn: unknown, tenant: string, _user: unknown, projectId: string) => {
    state.authorizedProjects.push({ tenant, projectId });
    return { project_id: projectId };
  },
  assertProjectMutationAllowed: async () => ({ project_id: 'P1' }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (error: string) => ({ error }),
  permissionError: (permissionError: string) => ({ permissionError }),
}));

import {
  deleteTenantProjectStatus,
  getPhaseCustomStatusCounts,
  updateTenantProjectStatus,
  validateTenantProjectStatusDeletion,
} from './projectTaskStatusActions';

beforeEach(() => {
  state.tenant = 'tenant-a';
  state.tenantDbCalls = [];
  state.authorizedProjects = [];
  state.rows = {
    project_status_mappings: [
      { tenant: 'tenant-a', project_id: 'P1', phase_id: 'phase-a', status_id: 'count-status' },
      { tenant: 'tenant-a', project_id: 'P1', phase_id: 'phase-a', status_id: 'count-status' },
      { tenant: 'tenant-b', project_id: 'P1', phase_id: 'phase-a', status_id: 'shared-status' },
      { tenant: 'tenant-b', project_id: 'P1', phase_id: 'phase-b', status_id: 'shared-status' },
    ],
    statuses: [
      { tenant: 'tenant-a', status_id: 'shared-status', status_type: 'project_task', name: 'Shared' },
      { tenant: 'tenant-b', status_id: 'shared-status', status_type: 'project_task', name: 'Shared' },
    ],
    project_template_status_mappings: [
      { tenant: 'tenant-b', template_id: 'template-b', status_id: 'shared-status', template_name: 'Tenant B template' },
    ],
    project_templates: [],
    projects: [],
  };
});

describe('project task status actions preserve tenant isolation', () => {
  it('returns only the current tenant project status counts', async () => {
    const result = await getPhaseCustomStatusCounts('P1');

    expect(result).toEqual({ 'phase-a': 2 });
    expect(state.authorizedProjects).toEqual([{ tenant: 'tenant-a', projectId: 'P1' }]);
    expect(state.tenantDbCalls.length).toBeGreaterThan(0);
    expect(new Set(state.tenantDbCalls)).toEqual(new Set(['tenant-a']));
  });

  it('validates and deletes a library status using only the current tenant rows', async () => {
    const tenantAValidation = await validateTenantProjectStatusDeletion('shared-status');
    expect(tenantAValidation.canDelete).toBe(true);

    state.tenant = 'tenant-b';
    const tenantBValidation = await validateTenantProjectStatusDeletion('shared-status');
    expect(tenantBValidation).toMatchObject({ canDelete: false, code: 'DEPENDENCIES_EXIST' });
    expect(tenantBValidation.dependencies[0]).toMatchObject({ label: 'project template' });

    state.tenantDbCalls = [];
    state.tenant = 'tenant-a';
    await deleteTenantProjectStatus('shared-status');
    expect(state.rows.statuses).toContainEqual(expect.objectContaining({ tenant: 'tenant-b', status_id: 'shared-status' }));
    expect(state.rows.statuses).not.toContainEqual(expect.objectContaining({ tenant: 'tenant-a', status_id: 'shared-status' }));

    state.tenant = 'tenant-b';
    state.tenantDbCalls = [];
    const blockedDelete = await deleteTenantProjectStatus('shared-status');
    expect(blockedDelete).toMatchObject({ error: expect.stringContaining('used by 1 project template') });
    expect(state.rows.statuses).toContainEqual(expect.objectContaining({ tenant: 'tenant-b', status_id: 'shared-status' }));
    expect(new Set(state.tenantDbCalls)).toEqual(new Set(['tenant-b']));
  });

  it('updates only the current tenant status row when IDs overlap', async () => {
    state.tenant = 'tenant-a';
    await updateTenantProjectStatus('shared-status', { name: 'Tenant A status' });

    expect(state.rows.statuses).toContainEqual(expect.objectContaining({
      tenant: 'tenant-a', status_id: 'shared-status', name: 'Tenant A status',
    }));
    expect(state.rows.statuses).toContainEqual(expect.objectContaining({
      tenant: 'tenant-b', status_id: 'shared-status', name: 'Shared',
    }));
    expect(state.tenantDbCalls).toEqual(['tenant-a']);
  });
});
