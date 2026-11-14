import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';
const PHASE = '33333333-3333-3333-3333-333333333333';
const TASK = '44444444-4444-4444-4444-444444444444';

const state = vi.hoisted(() => ({ redactedFields: [] as string[] }));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyForTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
    validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', tenant: TENANT })),
}));
vi.mock('@/lib/db', () => ({ runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async (original) => ({
  ...(await original<typeof import('@alga-psa/db')>()),
  tenantDb: vi.fn(() => ({
    tenantJoin: vi.fn(),
    table: () => ({ where: () => ({ first: async () => ({ project_id: PROJECT }) }) }),
  })),
}));
vi.mock('@/lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: vi.fn(async () => ({ allowed: true, redactedFields: state.redactedFields })),
}));
vi.mock('@/lib/api/services/ProjectService', () => ({ ProjectService: class {} }));

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const project = { project_id: PROJECT, project_name: 'Migration' };
const task = { task_id: TASK, phase_id: PHASE, task_name: 'Prepare migration', phase_name: 'Planning', project_id: PROJECT, project_name: 'Migration', estimated_hours: 80, description: 'Task details' };
const phase = { phase_id: PHASE, project_id: PROJECT, phase_name: 'Planning', project_name: 'Migration', start_date: '2026-01-01', description: 'Phase details' };

const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { 'x-api-key': 'key' } });

function makeController() {
  const controller = new ApiProjectController() as any;
  controller.assertProductApiAccess = async () => undefined;
  controller.projectService = {
    getById: async () => project,
    getTaskById: async () => task,
    getProjectTasks: async () => [task],
    listPhases: async () => [phase],
    listPhaseTasks: async () => [task],
  };
  return controller;
}

async function body(response: Response) {
  return response.json();
}

beforeEach(() => {
  state.redactedFields = [];
});

describe('project child read response projections', () => {
  it('projects getTask with its parent project policy and preserves unrestricted fields', async () => {
    const controller = makeController();
    const unrestricted = await body(await controller.getTask()(req(`/api/v1/projects/tasks/${TASK}`)));
    expect(unrestricted.data).toMatchObject({ task_id: TASK, task_name: task.task_name, project_name: 'Migration', estimated_hours: 80 });

    state.redactedFields = ['projects.project_name'];
    const redacted = await body(await controller.getTask()(req(`/api/v1/projects/tasks/${TASK}`)));
    expect(redacted.data).toMatchObject({ task_id: TASK, task_name: task.task_name });
    expect(redacted.data).not.toHaveProperty('project_name');

    state.redactedFields = ['project_phases.phase_name'];
    const hiddenPhaseName = await body(await controller.getTask()(req(`/api/v1/projects/tasks/${TASK}`)));
    expect(hiddenPhaseName.data).not.toHaveProperty('phase_name');

    state.redactedFields = ['project_tasks.estimated_hours'];
    const hiddenTaskHours = await body(await controller.getTask()(req(`/api/v1/projects/tasks/${TASK}`)));
    expect(hiddenTaskHours.data).not.toHaveProperty('estimated_hours');
    expect(hiddenTaskHours.data.task_name).toBe(task.task_name);

    state.redactedFields = ['project_tasks.project_name'];
    const hiddenProjectName = await body(await controller.getTask()(req(`/api/v1/projects/tasks/${TASK}`)));
    expect(hiddenProjectName.data).not.toHaveProperty('project_name');
    expect(hiddenProjectName.data.task_name).toBe(task.task_name);
  });

  it('projects task and phase collections and suppresses hidden identifiers or resources', async () => {
    const controller = makeController();
    state.redactedFields = ['projects.project_name'];
    for (const response of [
      await controller.getTasks()(req(`/api/v1/projects/${PROJECT}/tasks`)),
      await controller.listPhaseTasks()(req(`/api/v1/projects/phases/${PHASE}/tasks`)),
      await controller.listPhases()(req(`/api/v1/projects/${PROJECT}/phases`)),
    ]) {
      const result = await body(response);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).not.toHaveProperty('project_name');
    }
    const unrestrictedPhase = await body(await controller.listPhases()(req(`/api/v1/projects/${PROJECT}/phases`)));
    expect(unrestrictedPhase.data[0].start_date).toBe('2026-01-01');

    state.redactedFields = ['tasks.task_id'];
    const hiddenTaskResponse = await controller.getTask()(req(`/api/v1/projects/tasks/${TASK}`));
    expect(hiddenTaskResponse.status).toBe(404);
    expect((await body(await controller.getTasks()(req(`/api/v1/projects/${PROJECT}/tasks`)))).data).toEqual([]);

    state.redactedFields = ['project_phases'];
    expect((await body(await controller.listPhases()(req(`/api/v1/projects/${PROJECT}/phases`)))).data).toEqual([]);

    state.redactedFields = ['project_phases.phase_id'];
    expect((await body(await controller.listPhases()(req(`/api/v1/projects/${PROJECT}/phases`)))).data).toEqual([]);

    state.redactedFields = ['project_phases.start_date'];
    const hiddenPhaseDates = await body(await controller.listPhases()(req(`/api/v1/projects/${PROJECT}/phases`)));
    expect(hiddenPhaseDates.data[0]).not.toHaveProperty('start_date');

    state.redactedFields = ['project_tasks'];
    expect((await body(await controller.listPhaseTasks()(req(`/api/v1/projects/phases/${PHASE}/tasks`)))).data).toEqual([]);

    for (const restriction of ['project_tasks.estimated_hours', 'project_tasks.project_name']) {
      state.redactedFields = [restriction];
      for (const response of [
        await controller.getTasks()(req(`/api/v1/projects/${PROJECT}/tasks`)),
        await controller.listPhaseTasks()(req(`/api/v1/projects/phases/${PHASE}/tasks`)),
      ]) {
        const result = await body(response);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).not.toHaveProperty(restriction.endsWith('estimated_hours') ? 'estimated_hours' : 'project_name');
        expect(result.data[0].task_name).toBe(task.task_name);
      }
    }
  });
});
