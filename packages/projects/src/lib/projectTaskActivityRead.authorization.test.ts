import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  decisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  loadedRedactions: [] as string[][],
}));

vi.mock('@alga-psa/authorization/projectReadAuthorization', () => ({
  authorizeProjectsByIds: vi.fn(async (_trx: unknown, _tenant: string, _reader: unknown, ids: string[]) => ids.map((id) => ({
    project: { project_id: id, client_id: `client-${id}` },
    ...(state.decisions.get(id) ?? { allowed: true, redactedFields: [] }),
  }))),
}));
vi.mock('./projectTaskReadProjection', () => ({
  loadAuthorizedProjectTasks: vi.fn(async (_trx: unknown, _tenant: string, projectId: string, fields: string[], taskIds: string[]) => {
    state.loadedRedactions.push(fields);
    return taskIds.map((task_id) => ({ tenant: 'tenant-1', task_id, phase_id: `phase-${projectId}`, project_id: projectId,
      task_name: fields.includes('task_name') ? 'Project task' : `Task ${task_id}`, description: null,
      wbs_code: fields.some((field) => field === 'wbs_code' || field === 'wbsCode') ? null : '1.2',
      project_status_mapping_id: fields.some((field) => ['status', 'statusMappingId'].includes(field)) ? null : 'mapping-1',
      assigned_to: 'owner-1', priority_id: null, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-02T00:00:00Z'),
    }));
  }),
}));
vi.mock('./projectPhaseReadProjection', () => ({
  loadAuthorizedProjectPhase: vi.fn(async (_trx: unknown, _tenant: string, phaseId: string, fields: string[]) => ({
    phase_id: phaseId, project_id: phaseId.replace('phase-', ''), phase_name: fields.includes('phase_name') ? 'Project phase' : 'Phase One',
  })),
}));
vi.mock('../models/project', () => ({ default: {
  getByIds: async (_trx: unknown, _tenant: string, ids: string[]) => ids.map((project_id) => ({ project_id, project_name: `Project ${project_id}`, is_closed: false, client_id: `client-${project_id}` })),
  getMaskedByIds: async (_trx: unknown, _tenant: string, ids: string[], fields: string[]) => ids.map((project_id) => ({ project_id,
    project_name: fields.includes('project_name') ? 'Project' : `Project ${project_id}`, is_closed: false, client_id: `client-${project_id}` })),
} }));
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: () => ({ where() { return this; }, select() { return this; }, first: async () => null }), tenantJoin() {} }), raw: (sql: string) => sql }));

import { loadAuthorizedProjectTaskActivities } from './projectTaskActivityRead';

const reader = { user_id: 'reader-1', user_type: 'internal' } as any;

beforeEach(() => {
  state.decisions.clear();
  state.loadedRedactions = [];
});

describe('authorized project task activity projection', () => {
  it('omits denied projects, applies each effective mask, and restores values when access returns', async () => {
    const identities = [
      { taskId: 'task-1', projectId: 'project-1' },
      { taskId: 'task-2', projectId: 'project-2' },
    ];
    const trx = { raw: (sql: string) => sql } as any;

    const allowed = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(allowed).toHaveLength(2);
    expect(allowed[0]).toMatchObject({ task: { task_name: 'Task task-1', wbs_code: '1.2', project_status_mapping_id: 'mapping-1' }, phaseName: 'Phase One' });

    state.decisions.set('project-1', { allowed: true, redactedFields: ['task_name', 'phase_name', 'wbsCode', 'statusMappingId'] });
    state.decisions.set('project-2', { allowed: false, redactedFields: [] });
    const restricted = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(restricted).toHaveLength(1);
    expect(restricted[0]).toMatchObject({
      task: { task_name: 'Project task', wbs_code: null, project_status_mapping_id: null },
      phaseName: 'Project phase',
    });
    expect(state.loadedRedactions.at(-1)).toEqual(['phase_name', 'statusMappingId', 'task_name', 'wbsCode']);

    state.decisions.set('project-1', { allowed: false, redactedFields: [] });
    expect(await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities)).toEqual([]);

    state.decisions.set('project-1', { allowed: true, redactedFields: [] });
    const restored = await loadAuthorizedProjectTaskActivities(trx, 'tenant-1', reader, identities);
    expect(restored.find(({ task }) => task.task_id === 'task-1')).toMatchObject({
      task: { task_name: 'Task task-1', wbs_code: '1.2', project_status_mapping_id: 'mapping-1' }, phaseName: 'Phase One',
    });
  });
});
