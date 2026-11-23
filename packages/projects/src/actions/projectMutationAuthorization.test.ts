import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  decisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  persisted: { phase: 'initial phase', task: 'initial task', status: 'initial status', mapping: 'initial mapping' },
  statusProjects: ['p1', 'p2'],
  writes: [] as string[],
  foreignTask: false,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) => fn({ user_id: 'u1', user_type: 'internal', roles: [] }, { tenant: 't1' }, ...args),
  withOptionalAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) => fn({ user_id: 'u1', user_type: 'internal', roles: [] }, { tenant: 't1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
  registerAfterCommit: vi.fn(),
  tenantDb: () => ({
    table(name: string) {
      const builder: any = {
        where: (conditions: Record<string, string> | string) => {
          if (typeof conditions === 'object' && conditions['pt.task_id'] === 'foreign-task') state.foreignTask = true;
          return builder;
        },
        join: (_table: string, callback: (this: any) => void) => {
          callback.call({ on() { return this; }, andOn() { return this; } });
          return builder;
        },
        first: async () => state.foreignTask ? undefined : name.includes('project_phases') ? { project_id: 'p1' } : { phase_id: 'ph1' },
        select: async () => name.includes('project_status_mappings') ? state.statusProjects.map((project_id) => ({ project_id })) : [],
      };
      return builder;
    },
  }),
}));
vi.mock('../models/project', () => ({ default: {
  getById: async (_trx: unknown, _tenant: string, project_id: string) => ({ project_id, client_id: 'c1', assigned_to: 'u1' }),
  updatePhase: async (_trx: unknown, _tenant: string, _id: string, updates: any) => {
    state.writes.push('phase');
    state.persisted.phase = updates.phase_name;
    return { ...updates, project_id: 'p1' };
  },
  updateStructure: async (_trx: unknown, _tenant: string, _projectId: string, updates: any) => {
    state.writes.push('structure');
    state.persisted.phase = updates.phases[0]?.phase_name ?? state.persisted.phase;
    state.persisted.task = updates.tasks[0]?.task_name ?? state.persisted.task;
  },
  updateProjectStatus: async (_trx: unknown, _tenant: string, _id: string, status: any, mapping: any) => {
    state.writes.push('status');
    state.persisted.status = status.name ?? state.persisted.status;
    state.persisted.mapping = mapping.custom_name ?? state.persisted.mapping;
    return status;
  },
} }));
vi.mock('../lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async (_trx: unknown, _tenant: string, _user: unknown, action = 'read') => async (project: { project_id?: string }) =>
    action === 'read' ? { allowed: true, redactedFields: [] } : state.decisions.get(project.project_id ?? '') ?? { allowed: true, redactedFields: [] },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));

import { updatePhase, updateProjectStatus, updateProjectStructure } from './projectActions';

const denied = { allowed: false, redactedFields: [] };
const wildcard = { allowed: true, redactedFields: ['*'] };
const call = {
  phase: () => updatePhase('ph1', { phase_name: 'changed phase' }),
  structure: (taskName = 'changed task') => updateProjectStructure('p1', {
    phases: [{ phase_id: 'ph1', phase_name: 'changed phase' }],
    tasks: [{ task_id: 'task1', task_name: taskName }],
  }),
  status: () => updateProjectStatus('p1', 's1', { name: 'changed status' }, { custom_name: 'changed mapping' }),
};

describe('project child mutation authorization', () => {
  beforeEach(() => {
    state.decisions.clear();
    state.persisted = { phase: 'initial phase', task: 'initial task', status: 'initial status', mapping: 'initial mapping' };
    state.statusProjects = ['p1', 'p2'];
    state.writes = [];
    state.foreignTask = false;
  });

  it.each(['phase', 'structure', 'status'] as const)('%s rejects a denied effective update decision after an allowed clean read', async (action) => {
    state.decisions.set('p1', denied);
    await call[action]();
    expect(state.writes).toEqual([]);
    expect(state.persisted).toEqual({ phase: 'initial phase', task: 'initial task', status: 'initial status', mapping: 'initial mapping' });
  });

  it.each(['phase', 'structure', 'status'] as const)('%s rejects wildcard-redacted update access after an allowed clean read', async (action) => {
    state.decisions.set('p1', wildcard);
    await call[action]();
    expect(state.writes).toEqual([]);
    expect(state.persisted).toEqual({ phase: 'initial phase', task: 'initial task', status: 'initial status', mapping: 'initial mapping' });
  });

  it.each([
    ['phase', { project_phase: ['phase_name'] }],
    ['structure', { project_task: ['task_name'] }],
    ['status', { status: ['name'] }],
  ] as const)('%s rejects a write to a specifically redacted child field', async (action, redaction) => {
    state.decisions.set('p1', { allowed: true, redactedFields: Object.entries(redaction).flatMap(([resource, fields]) => (fields as readonly string[]).map((field) => `${resource}.${field}`)) });
    await call[action]();
    expect(state.writes).toEqual([]);
    expect(state.persisted).toEqual({ phase: 'initial phase', task: 'initial task', status: 'initial status', mapping: 'initial mapping' });
  });

  it.each(['phase', 'structure', 'status'] as const)('%s persists the intended change for unrestricted access', async (action) => {
    await call[action]();
    expect(state.writes).toHaveLength(1);
    if (action === 'phase') expect(state.persisted.phase).toBe('changed phase');
    if (action === 'structure') expect(state.persisted).toMatchObject({ phase: 'changed phase', task: 'changed task' });
    if (action === 'status') expect(state.persisted).toMatchObject({ status: 'changed status', mapping: 'changed mapping' });
  });

  it('checks every project affected by a shared status before updating any status rows', async () => {
    state.decisions.set('p2', denied);
    await call.status();
    expect(state.writes).toEqual([]);
    expect(state.persisted).toMatchObject({ status: 'initial status', mapping: 'initial mapping' });
  });

  it('rejects a structure batch containing a task owned by another project before any update', async () => {
    state.foreignTask = false;
    const result = await updateProjectStructure('p1', {
      phases: [{ phase_id: 'ph1', phase_name: 'changed phase' }],
      tasks: [{ task_id: 'foreign-task', task_name: 'changed task' }],
    });
    expect(result).toBeDefined();
    expect(state.writes).toEqual([]);
    expect(state.persisted).toEqual({ phase: 'initial phase', task: 'initial task', status: 'initial status', mapping: 'initial mapping' });
  });
});
