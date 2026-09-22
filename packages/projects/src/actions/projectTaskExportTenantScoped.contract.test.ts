import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskExportActions.ts'), 'utf8');

describe('project task export tenant-scoped query contract', () => {
  it('uses structural tenant scoping for export lookup and task roots', () => {
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'teams', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings as psm', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'priorities', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'custom_task_types', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(source).toContain("tenantDb(trx, tenant).table('standard_task_types')");
    expect(source).not.toContain("trx('standard_task_types')");
    expect(source).toContain("db.tenantJoin(statusMappingsQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' })");
    expect(source).toContain("db.tenantJoin(statusMappingsQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' })");
    expect(source).not.toContain(".andWhere('tenant', tenant)");
    expect(source).not.toContain(".andWhere('psm.tenant', tenant)");
    expect(source).not.toContain('.where({ tenant, is_active: true })');
    expect(source).not.toContain('.where({ project_id: projectId, tenant })');
  });
});

const tableRows = vi.hoisted(() => ({ current: {} as Record<string, any[]> }));

/** Chainable thenable stub that resolves the rows configured for its table. */
function queryStub(table: string): any {
  const rows = () => tableRows.current[table] ?? [];
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (onFulfilled: any, onRejected: any) => Promise.resolve(rows()).then(onFulfilled, onRejected);
        }
        if (prop === 'first') return async () => rows()[0];
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: () => ({
    table: (table: string) => queryStub(table),
    tenantJoin: (query: any) => query,
  }),
  withTransaction: async (_db: unknown, cb: any) => cb({ raw: (sql: string) => sql }),
}));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ findTagsByEntityIds: vi.fn(async () => []) }));
vi.mock('@alga-psa/tags/actions/tagActionErrors', () => ({ isTagActionError: () => false }));
vi.mock('../lib/taskRichText', () => ({ extractTaskDescriptionText: (value: any) => value ?? '' }));
vi.mock('@shared/services/productAccessGuard', () => ({
  assertPsaOnlyTenantAccess: vi.fn(async () => undefined),
  ProductAccessError: class ProductAccessError extends Error {},
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ error: message }),
  permissionError: (message: string) => ({ error: message }),
}));

import { exportProjectTasksToCSV } from './projectTaskExportActions';

describe('project task export duration units', () => {
  beforeEach(() => {
    tableRows.current = {
      project_phases: [{ phase_id: 'phase-1', phase_name: 'Planning' }],
      project_tasks: [
        {
          task_id: 'task-1',
          task_name: 'Gather Requirements',
          description: null,
          description_rich_text: null,
          phase_id: 'phase-1',
          assigned_to: null,
          assigned_team_id: null,
          // Stored as BIGINT minutes: 16h estimated, 1.5h actual.
          estimated_hours: 960,
          actual_hours: 90,
          project_status_mapping_id: 'psm-1',
          created_at: new Date('2026-09-22T00:00:00.000Z'),
          updated_at: new Date('2026-09-22T00:00:00.000Z'),
          wbs_code: '1.1',
          due_date: null,
          priority_id: null,
          task_type_key: 'task',
          tenant: 'tenant-1',
        },
      ],
      'project_status_mappings as psm': [
        { project_status_mapping_id: 'psm-1', status_name: 'To Do', is_closed: false },
      ],
      standard_task_types: [{ type_key: 'task', type_name: 'Task' }],
      custom_task_types: [],
      task_checklist_items: [],
    };
  });

  it('writes hours under the Estimated Hours and Actual Hours headers', async () => {
    // The importer reads these columns as hours, so the export has to divide the
    // stored minutes — otherwise a re-import multiplies every estimate by 60.
    const result = await exportProjectTasksToCSV('project-1', ['phase-1']);

    expect('csv' in result).toBe(true);
    const [headerLine, dataLine] = (result as { csv: string }).csv.split('\n');
    const headers = headerLine.split(',');
    const values = dataLine.split(',');

    expect(values[headers.indexOf('Estimated Hours')]).toBe('16');
    expect(values[headers.indexOf('Actual Hours')]).toBe('1.5');
  });
});
