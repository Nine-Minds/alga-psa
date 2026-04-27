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
  'projects.duplicate_task',
  'projects.delete_task',
  'projects.delete_phase',
  'projects.delete',
  'projects.link_ticket_to_task',
  'projects.add_tag',
  'projects.add_task_tag',
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
    expect(byId.get('projects.duplicate_task')?.ui?.label).toBe('Duplicate Project Task');
    expect(byId.get('projects.delete_task')?.ui?.label).toBe('Delete Project Task');
    expect(byId.get('projects.delete_phase')?.ui?.label).toBe('Delete Project Phase');
    expect(byId.get('projects.delete')?.ui?.label).toBe('Delete Project');
    expect(byId.get('projects.link_ticket_to_task')?.ui?.label).toBe('Link Ticket to Project Task');
    expect(byId.get('projects.add_tag')?.ui?.label).toBe('Add Tag to Project');
    expect(byId.get('projects.add_task_tag')?.ui?.label).toBe('Add Tag to Project Task');

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
    expect(byId.get('projects.duplicate_task')?.sideEffectful).toBe(true);
    expect(byId.get('projects.delete_task')?.sideEffectful).toBe(true);
    expect(byId.get('projects.delete_phase')?.sideEffectful).toBe(true);
    expect(byId.get('projects.delete')?.sideEffectful).toBe(true);
    expect(byId.get('projects.link_ticket_to_task')?.sideEffectful).toBe(true);
    expect(byId.get('projects.add_tag')?.sideEffectful).toBe(true);
    expect(byId.get('projects.add_task_tag')?.sideEffectful).toBe(true);

    for (const id of EXPECTED_PROJECT_ACTION_IDS) {
      const expectedIdempotency = id === 'projects.link_ticket_to_task' || id === 'projects.add_tag' || id === 'projects.add_task_tag'
        ? 'actionProvided'
        : 'engineProvided';
      expect(byId.get(id)?.idempotency.mode).toBe(expectedIdempotency);
      expect(byId.get(id)?.ui?.category).toBe('Business Operations');
    }
  });

  it('T023: project actions expose expected project/phase/task/status picker metadata', () => {
    const registry = getActionRegistryV2();

    const createTask = registry.get('projects.create_task', 1);
    const findPhase = registry.get('projects.find_phase', 1);
    const findTask = registry.get('projects.find_task', 1);
    const searchTasks = registry.get('projects.search_tasks', 1);
    const moveTask = registry.get('projects.move_task', 1);
    const duplicateTask = registry.get('projects.duplicate_task', 1);
    const linkTicketToTask = registry.get('projects.link_ticket_to_task', 1);
    const addTag = registry.get('projects.add_tag', 1);
    const addTaskTag = registry.get('projects.add_task_tag', 1);

    expect(createTask).toBeDefined();
    expect(findPhase).toBeDefined();
    expect(findTask).toBeDefined();
    expect(searchTasks).toBeDefined();
    expect(moveTask).toBeDefined();
    expect(duplicateTask).toBeDefined();
    expect(linkTicketToTask).toBeDefined();
    expect(addTag).toBeDefined();
    expect(addTaskTag).toBeDefined();

    if (!createTask || !findPhase || !findTask || !searchTasks || !moveTask || !duplicateTask || !linkTicketToTask || !addTag || !addTaskTag) {
      throw new Error('Missing expected project actions');
    }

    const createTaskSchema = zodToWorkflowJsonSchema(createTask.inputSchema);
    const findPhaseSchema = zodToWorkflowJsonSchema(findPhase.inputSchema);
    const findTaskSchema = zodToWorkflowJsonSchema(findTask.inputSchema);
    const searchTasksSchema = zodToWorkflowJsonSchema(searchTasks.inputSchema);
    const moveTaskSchema = zodToWorkflowJsonSchema(moveTask.inputSchema);
    const duplicateTaskSchema = zodToWorkflowJsonSchema(duplicateTask.inputSchema);
    const linkTicketToTaskSchema = zodToWorkflowJsonSchema(linkTicketToTask.inputSchema);
    const addTagSchema = zodToWorkflowJsonSchema(addTag.inputSchema);
    const addTaskTagSchema = zodToWorkflowJsonSchema(addTaskTag.inputSchema);

    const createTaskProps = createTaskSchema.properties as Record<string, any>;
    const findPhaseProps = findPhaseSchema.properties as Record<string, any>;
    const findTaskProps = findTaskSchema.properties as Record<string, any>;
    const searchTasksProps = searchTasksSchema.properties as Record<string, any>;
    const searchTasksFilters = (searchTasksProps.filters as Record<string, any> | undefined)?.properties ?? {};
    const moveTaskProps = moveTaskSchema.properties as Record<string, any>;
    const duplicateTaskProps = duplicateTaskSchema.properties as Record<string, any>;
    const linkTicketToTaskProps = linkTicketToTaskSchema.properties as Record<string, any>;
    const addTagProps = addTagSchema.properties as Record<string, any>;
    const addTaskTagProps = addTaskTagSchema.properties as Record<string, any>;

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

    expect(moveTaskProps.task_id?.['x-workflow-picker-kind']).toBe('project-task');
    expect(moveTaskProps.target_phase_id?.['x-workflow-picker-kind']).toBe('project-phase');
    expect(moveTaskProps.target_project_status_mapping_id?.['x-workflow-picker-kind']).toBe('project-task-status');
    expect(moveTaskProps.before_task_id?.['x-workflow-picker-dependencies']).toEqual(['target_project_id', 'target_phase_id']);

    expect(duplicateTaskProps.source_task_id?.['x-workflow-picker-kind']).toBe('project-task');
    expect(duplicateTaskProps.target_phase_id?.['x-workflow-picker-kind']).toBe('project-phase');
    expect(duplicateTaskProps.target_project_status_mapping_id?.['x-workflow-picker-kind']).toBe('project-task-status');

    expect(linkTicketToTaskProps.task_id?.['x-workflow-picker-kind']).toBe('project-task');
    expect(linkTicketToTaskProps.ticket_id?.['x-workflow-picker-kind']).toBe('ticket');
    expect(linkTicketToTaskProps.phase_id?.['x-workflow-picker-kind']).toBe('project-phase');

    expect(addTagProps.project_id?.['x-workflow-picker-kind']).toBe('project');
    expect(addTagProps.tags?.items?.['x-workflow-picker-kind']).toBeUndefined();
    expect(addTaskTagProps.task_id?.['x-workflow-picker-kind']).toBe('project-task');
    expect(addTaskTagProps.tags?.items?.['x-workflow-picker-kind']).toBeUndefined();
  });
});
