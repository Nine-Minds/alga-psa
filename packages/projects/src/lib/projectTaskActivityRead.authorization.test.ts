import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  redactedFields: [] as string[],
  tenant: 'tenant-1',
  decisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
}));

const fixtures = {
  task: {
    tenant: 'tenant-1', task_id: 'task-1', phase_id: 'phase-1', project_status_mapping_id: 'mapping-1',
    priority_id: 'priority-1', task_name: 'Restore the network', description: 'Protected task description',
    description_rich_text: '<p>Protected task description</p>', assigned_to: 'owner-1', assigned_team_id: 'team-1', estimated_hours: 3,
    actual_hours: 1, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-02T00:00:00Z'),
    wbs_code: '1.2', order_key: 'a', start_date: new Date('2026-01-03T00:00:00Z'),
    due_date: new Date('2026-01-04T00:00:00Z'), task_type_key: 'task', service_id: 'service-1',
  },
  phase: {
    tenant: 'tenant-1', phase_id: 'phase-1', project_id: 'project-1', phase_name: 'Network work',
    description: null, start_date: null, end_date: null, completed_at: null, status: null, order_number: 1,
    order_key: 'a', created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-02T00:00:00Z'),
    wbs_code: '1', service_id: null,
  },
  mapping: { tenant: 'tenant-1', project_status_mapping_id: 'mapping-1', project_id: 'project-1', phase_id: 'phase-1', custom_name: 'Blocked', status_id: 'status-1', standard_status_id: null },
  status: { tenant: 'tenant-1', status_id: 'status-1', name: 'Custom blocked', color: '#bb0000', is_closed: true },
  priority: { tenant: 'tenant-1', priority_id: 'priority-1', priority_name: 'High', color: '#aa0000', item_type: 'project_task' },
  user: { tenant: 'tenant-1', user_id: 'owner-1', first_name: 'Task', last_name: 'Owner' },
};

const tasks = [fixtures.task, { ...fixtures.task, task_id: 'task-2', phase_id: 'phase-2',
  project_status_mapping_id: null, task_name: 'Review the firewall' }];
const phases = [fixtures.phase, { ...fixtures.phase, phase_id: 'phase-2', project_id: 'project-2',
  phase_name: 'Firewall work' }];

function tableName(expression: string) {
  const [tableName, alias] = expression.split(/\s+as\s+/i);
  return { tableName, alias: alias ?? tableName };
}

function rawValue(selection: { sql: string; args?: unknown[] }, joined: Record<string, any>) {
  const { sql, args = [] } = selection;
  const output = String(args.at(-1) ?? (sql.match(/\bas\s+([a-z_]+)$/i)?.[1] ?? ''));
  if (sql.startsWith('NULL::')) return [output, null];
  if (sql.includes('?::text as task_name')) return ['task_name', args[0]];
  if (sql.includes('?::text as ??')) return [String(args[1]), args[0]];
  if (sql.includes('CASE WHEN FALSE')) return [output, null];
  if (sql.includes('CONCAT(users.first_name')) return ['assigned_to_name', `${joined.users?.first_name ?? ''} ${joined.users?.last_name ?? ''}`.trim()];
  if (sql.includes('COALESCE(psm.custom_name, cs.name, ss.name)')) return ['status_name', joined.psm?.custom_name ?? joined.cs?.name ?? joined.ss?.name ?? null];
  if (sql.includes('CASE WHEN psm.project_status_mapping_id IS NULL')) return ['is_closed', joined.psm ? Boolean(joined.cs?.is_closed ?? joined.ss?.is_closed ?? false) : null];
  if (sql.includes('cs.color')) return ['status_color', joined.cs?.color ?? null];
  if (sql.includes('priorities.priority_name')) return ['priority_name', joined.priorities?.priority_name ?? null];
  if (sql.includes('priorities.color')) return ['priority_color', joined.priorities?.color ?? null];
  return [output, null];
}

function makeQuery(rootExpression: string, tenant: string) {
  const { tableName: rootTable, alias: rootAlias } = tableName(rootExpression);
  const filters: Array<{ kind: 'where' | 'whereIn'; field: any; value?: any }> = [];
  const joins: Array<{ expression: string; left: string; right: string; type: string }> = [];
  let selections: any[] = [];
  const builder: any = {
    where(field: any, value?: any) { filters.push({ kind: 'where', field, value }); return builder; },
    join(expression: string, left: string, right: string, type = 'inner') { joins.push({ expression, left, right, type }); return builder; },
    whereIn(field: any, value: any[]) { filters.push({ kind: 'whereIn', field, value }); return builder; },
    select(...values: any[]) { selections = values.flat(); return builder; },
    orderBy() { return builder; },
    first(...values: any[]) { if (values.length) selections = values.flat(); return Promise.resolve(execute()[0]); },
    then(resolve: (rows: any[]) => unknown, reject?: (error: unknown) => unknown) { return Promise.resolve(execute()).then(resolve, reject); },
  };
  function execute() {
    const rootRows = rootTable === 'project_tasks' ? tasks
      : rootTable === 'project_phases' ? phases : [];
    return rootRows.filter((row) => row.tenant === tenant).flatMap((rootRow) => {
      const joined: Record<string, any> = { [rootAlias]: rootRow };
      let rows: Array<Record<string, any>> = [joined];
      for (const item of joins) {
        const { tableName: joinedTable, alias } = tableName(item.expression);
        const source = ({
          project_phases: phases, users: [fixtures.user], project_status_mappings: [fixtures.mapping],
          statuses: [fixtures.status], standard_statuses: [], priorities: [fixtures.priority],
        } as Record<string, any[]>)[joinedTable] ?? [];
        rows = rows.flatMap((current) => {
          const leftValue = current[item.left.split('.')[0]]?.[item.left.split('.')[1]];
          const matches = source.filter((candidate) => candidate.tenant === tenant
            && candidate[item.right.split('.')[1]] === leftValue
            && (joinedTable !== 'project_status_mappings' || candidate.project_id === current.project_phases?.project_id)
            && (joinedTable !== 'project_status_mappings' || candidate.phase_id == null || candidate.phase_id === current.project_tasks?.phase_id));
          if (matches.length) return matches.map((match) => ({ ...current, [alias]: match }));
          return item.type === 'left' ? [{ ...current, [alias]: null }] : [];
        });
      }
      return rows.filter((current) => filters.every((filter) => {
        if (filter.kind === 'whereIn') return filter.value.includes(current[filter.field.split('.')[0]]?.[filter.field.split('.')[1]]);
        if (typeof filter.field === 'object') return Object.entries(filter.field).every(([key, value]) => { const [alias, field] = key.includes('.') ? key.split('.') : [rootAlias, key]; return current[alias]?.[field] === value; });
        return current[filter.field.split('.')[0]]?.[filter.field.split('.')[1]] === filter.value;
      })).map((current) => Object.fromEntries(selections.map((selection) => {
        if (typeof selection !== 'string') return rawValue(selection, current);
        const [reference, outputName] = selection.split(/\s+as\s+/i);
        const [alias, field] = reference.split('.');
        return [outputName ?? field, current[alias]?.[field] ?? null];
      })));
    });
  }
  return { builder };
}

vi.mock('@alga-psa/authorization/projectReadAuthorization', () => ({
  authorizeProjectsByIds: vi.fn(async (_trx: unknown, tenant: string, _reader: unknown, projectIds: string[]) => tenant === state.tenant
    ? projectIds.filter((projectId) => phases.some((phase) => phase.project_id === projectId)).map((project_id) => ({
      project: { project_id, client_id: 'client-1' },
      ...(state.decisions.get(project_id) ?? { allowed: true, redactedFields: [...state.redactedFields] }),
    }))
    : []),
}));
vi.mock('../models/project', () => ({ default: {
  getByIds: async (_trx: unknown, tenant: string, ids: string[]) => tenant === state.tenant ? ids.map((project_id) => ({ project_id, project_name: 'Network project', is_closed: false, client_id: 'client-1' })) : [],
  getMaskedByIds: async (_trx: unknown, tenant: string, ids: string[], fields: string[]) => tenant === state.tenant ? ids.map((project_id) => ({
    project_id, project_name: fields.includes('projects.project_name') ? 'Project' : 'Network project', is_closed: false, client_id: 'client-1',
  })) : [],
} }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (expression: string) => makeQuery(expression, tenant).builder,
    tenantJoin: (builder: any, expression: string, left: string, right: string, options: any = {}) => {
      const query = builder;
      query.join(expression, left, right, options.type);
      return builder;
    },
  }),
}));

import { loadAuthorizedProjectTaskActivities } from './projectTaskActivityRead';

const reader = { user_id: 'reader-1', user_type: 'internal' } as any;
const trx = { raw: (sql: string, args?: unknown[]) => ({ sql, args }) } as any;

beforeEach(() => { state.redactedFields = []; state.decisions.clear(); });

describe('authorized project task activity projection', () => {
  it.each([
    'phase_id', 'description_rich_text', 'estimated_hours', 'actual_hours', 'created_at',
    'order_key', 'start_date', 'due_date', 'task_type_key', 'service_id',
  ] as const)('masks the selected task column %s through each supported field path', async (field) => {
    const identities = [{ taskId: 'task-1', projectId: 'project-1' }];
    const [allowed] = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(allowed.task[field]).toEqual(fixtures.task[field]);
    expect(allowed.task[field]).not.toBeNull();

    for (const path of [field, `project_tasks.${field}`, `values.${field}`, `fields.values.${field}`]) {
      state.redactedFields = [path];
      const [masked] = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
      expect(masked.task[field], path).toBeNull();
      if (field === 'phase_id') expect(masked.phaseName).toBeNull();
    }
  });

  it.each(['priorities', 'priorities.priority_name', 'values.priorities', 'fields.values.priorities.color'])(
    'masks joined priority metadata when its source %s is hidden', async (redaction) => {
      state.redactedFields = [redaction];
      const [masked] = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, [
        { taskId: 'task-1', projectId: 'project-1' },
      ]);
      expect(masked).toMatchObject({ priorityName: null, priorityColor: null });
    },
  );

  it.each(['standard_statuses', 'fields.values.standard_statuses.name', 'status_id'])(
    'masks joined status metadata when its source %s is hidden', async (redaction) => {
      state.redactedFields = [redaction];
      const [masked] = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, [
        { taskId: 'task-1', projectId: 'project-1' },
      ]);
      expect(masked).toMatchObject({ statusName: null, statusColor: null, isClosed: false });
    },
  );

  it('uses real masked task and phase projections for populated status and priority data', async () => {
    const [allowed] = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, [
      { taskId: 'task-1', projectId: 'project-1' },
    ]);
    expect(allowed).toMatchObject({
      task: {
        task_name: 'Restore the network', status_name: 'Blocked', is_closed: true, status_color: '#bb0000',
        priority_name: 'High', priority_color: '#aa0000', wbs_code: '1.2',
      },
      phaseName: 'Network work',
    });

    for (const [redaction, expected] of [
      ['project_tasks.status_name', { statusName: null, statusColor: null }],
      ['project_tasks.is_closed', { isClosed: false }],
      ['statusMappingId', { statusName: null, statusColor: null, isClosed: false }],
      ['values.project_status_mapping_id', { statusName: null, statusColor: null, isClosed: false }],
      ['fields.values.project_status_mapping_id', { statusName: null, statusColor: null, isClosed: false }],
      ['fields.project_tasks.project_status_mapping_id', { statusName: null, statusColor: null, isClosed: false }],
      ['project_tasks.priority_name', { priorityName: null, priorityColor: null }],
      ['priorityId', { priorityName: null, priorityColor: null }],
      ['values.priority_id', { priorityName: null, priorityColor: null }],
      ['fields.values.priority_id', { priorityName: null, priorityColor: null }],
      ['fields.project_tasks.priority_id', { priorityName: null, priorityColor: null }],
      ['fields.values.status_name', { statusName: null, statusColor: null }],
      ['fields.values.priority_name', { priorityName: null, priorityColor: null }],
      ['project_tasks.priority_color', { priorityColor: null }],
      ['statusColor', { statusColor: null }],
      ['priorityColor', { priorityColor: null }],
    ] as const) {
      state.redactedFields = [redaction];
      const [masked] = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, [
        { taskId: 'task-1', projectId: 'project-1' },
      ]);
      expect(masked, redaction).toMatchObject(expected);
      if (redaction === 'project_tasks.status_name') expect(masked.statusName).not.toBe('Blocked');
      if (redaction === 'project_tasks.priority_name') expect(masked.priorityName).not.toBe('High');
      if (redaction.includes('project_status_mapping_id')) expect(masked.task.project_status_mapping_id).toBeNull();
      if (redaction.includes('priority_id')) expect(masked.task.priority_id).toBeNull();
    }
  });

  it('omits denied project tasks in mixed results and restores values when access returns', async () => {
    const identities = [
      { taskId: 'task-1', projectId: 'project-1' },
      { taskId: 'task-2', projectId: 'project-2' },
    ];
    const allowed = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(allowed.map(({ task }) => task.task_id)).toEqual(['task-1', 'task-2']);

    state.decisions.set('project-1', { allowed: true, redactedFields: ['task_name', 'phase_name', 'values.project_status_mapping_id'] });
    const redacted = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(redacted).toHaveLength(2);
    expect(redacted[0]).toMatchObject({ task: { task_name: 'Project task' }, phaseName: 'Project phase', statusName: null });
    expect(redacted[1]).toMatchObject({ task: { task_name: 'Review the firewall' }, phaseName: 'Firewall work', priorityName: 'High' });

    state.decisions.set('project-2', { allowed: false, redactedFields: [] });

    const mixed = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toMatchObject({ task: { task_id: 'task-1', task_name: 'Project task' },
      phaseName: 'Project phase', statusName: null, priorityName: 'High' });

    state.decisions.set('project-1', { allowed: false, redactedFields: [] });
    expect(await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities)).toEqual([]);

    state.decisions.delete('project-1');
    const restored = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ task: { task_name: 'Restore the network' }, statusName: 'Blocked', statusColor: '#bb0000', priorityName: 'High' });
  });

  it('omits identities outside the tenant or authorized project', async () => {
    expect(await loadAuthorizedProjectTaskActivities(trx, 'tenant-2', reader, [
      { taskId: 'task-1', projectId: 'project-1' },
    ])).toEqual([]);
    expect(await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, [
      { taskId: 'task-1', projectId: 'project-2' },
      { taskId: 'task-1', projectId: 'missing-project' },
    ])).toEqual([]);
  });
});
