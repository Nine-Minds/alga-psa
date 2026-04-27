import { beforeAll, describe, expect, it } from 'vitest';

import { zodToWorkflowJsonSchema } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { registerProjectActions } from '../businessOperations/projects';

const EXPECTED_PROJECT_ACTION_IDS = [
  'projects.create_task',
  'projects.find',
  'projects.search',
  'projects.find_phase',
  'projects.search_phases',
  'projects.find_task',
  'projects.search_tasks',
  'projects.update',
  'projects.update_phase',
  'projects.update_task',
  'projects.move_task',
  'projects.assign_task',
] as const;

describe('project workflow action registration metadata', () => {
  beforeAll(() => {
    const registry = getActionRegistryV2();
    if (!registry.get('projects.search_tasks', 1)) {
      registerProjectActions();
    }
  });

  it('T001: registers project find/search actions with expected labels and idempotency metadata', () => {
    const registry = getActionRegistryV2();

    const actions = EXPECTED_PROJECT_ACTION_IDS.map((id) => {
      const action = registry.get(id, 1);
      expect(action, `${id}@1 should be registered`).toBeDefined();
      return action!;
    });

    const byId = new Map(actions.map((action) => [action.id, action]));

    expect(byId.get('projects.create_task')?.ui?.label).toBe('Create Project Task');
    expect(byId.get('projects.find')?.ui?.label).toBe('Find Project');
    expect(byId.get('projects.search')?.ui?.label).toBe('Search Projects');
    expect(byId.get('projects.find_phase')?.ui?.label).toBe('Find Project Phase');
    expect(byId.get('projects.search_phases')?.ui?.label).toBe('Search Project Phases');
    expect(byId.get('projects.find_task')?.ui?.label).toBe('Find Project Task');
    expect(byId.get('projects.search_tasks')?.ui?.label).toBe('Search Project Tasks');
    expect(byId.get('projects.update')?.ui?.label).toBe('Update Project');
    expect(byId.get('projects.update_phase')?.ui?.label).toBe('Update Project Phase');
    expect(byId.get('projects.update_task')?.ui?.label).toBe('Update Project Task');
    expect(byId.get('projects.move_task')?.ui?.label).toBe('Move Project Task');
    expect(byId.get('projects.assign_task')?.ui?.label).toBe('Assign Project Task');

    expect(byId.get('projects.create_task')?.sideEffectful).toBe(true);
    expect(byId.get('projects.find')?.sideEffectful).toBe(false);
    expect(byId.get('projects.search')?.sideEffectful).toBe(false);
    expect(byId.get('projects.find_phase')?.sideEffectful).toBe(false);
    expect(byId.get('projects.search_phases')?.sideEffectful).toBe(false);
    expect(byId.get('projects.find_task')?.sideEffectful).toBe(false);
    expect(byId.get('projects.search_tasks')?.sideEffectful).toBe(false);
    expect(byId.get('projects.update')?.sideEffectful).toBe(true);
    expect(byId.get('projects.update_phase')?.sideEffectful).toBe(true);
    expect(byId.get('projects.update_task')?.sideEffectful).toBe(true);
    expect(byId.get('projects.move_task')?.sideEffectful).toBe(true);
    expect(byId.get('projects.assign_task')?.sideEffectful).toBe(true);

    for (const id of EXPECTED_PROJECT_ACTION_IDS) {
      expect(byId.get(id)?.idempotency.mode).toBe('engineProvided');
      expect(byId.get(id)?.ui?.category).toBe('Business Operations');
    }
  });

  it('T023: project actions expose expected project/phase/task/status picker metadata', () => {
    const registry = getActionRegistryV2();

    const createTask = registry.get('projects.create_task', 1);
    const findPhase = registry.get('projects.find_phase', 1);
    const findTask = registry.get('projects.find_task', 1);
    const searchTasks = registry.get('projects.search_tasks', 1);

    expect(createTask).toBeDefined();
    expect(findPhase).toBeDefined();
    expect(findTask).toBeDefined();
    expect(searchTasks).toBeDefined();

    if (!createTask || !findPhase || !findTask || !searchTasks) {
      throw new Error('Missing expected project actions');
    }

    const createTaskSchema = zodToWorkflowJsonSchema(createTask.inputSchema);
    const findPhaseSchema = zodToWorkflowJsonSchema(findPhase.inputSchema);
    const findTaskSchema = zodToWorkflowJsonSchema(findTask.inputSchema);
    const searchTasksSchema = zodToWorkflowJsonSchema(searchTasks.inputSchema);

    const createTaskProps = createTaskSchema.properties as Record<string, any>;
    const findPhaseProps = findPhaseSchema.properties as Record<string, any>;
    const findTaskProps = findTaskSchema.properties as Record<string, any>;
    const searchTasksFilters = (searchTasksSchema.properties?.filters as Record<string, any>)?.properties ?? {};

    expect(createTaskProps.project_id?.['x-workflow-picker-kind']).toBe('project');
    expect(createTaskProps.phase_id?.['x-workflow-picker-kind']).toBe('project-phase');
    expect(createTaskProps.phase_id?.['x-workflow-picker-dependencies']).toEqual(['project_id']);
    expect(createTaskProps.status_id?.['x-workflow-picker-kind']).toBe('project-task-status');

    expect(findPhaseProps.project_id?.['x-workflow-picker-kind']).toBe('project');
    expect(findPhaseProps.phase_id?.['x-workflow-picker-kind']).toBe('project-phase');

    expect(findTaskProps.task_id?.['x-workflow-picker-kind']).toBe('project-task');
    expect(findTaskProps.phase_id?.['x-workflow-picker-kind']).toBe('project-phase');

    expect(searchTasksFilters.project_id?.['x-workflow-picker-kind']).toBe('project');
    expect(searchTasksFilters.phase_id?.['x-workflow-picker-kind']).toBe('project-phase');
    expect(searchTasksFilters.phase_id?.['x-workflow-picker-dependencies']).toEqual(['filters.project_id']);
    expect(searchTasksFilters.project_status_mapping_id?.['x-workflow-picker-kind']).toBe('project-task-status');
  });
});
