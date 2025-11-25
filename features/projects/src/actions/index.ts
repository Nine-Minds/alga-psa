/**
 * Project server actions
 *
 * These are Next.js server actions for project operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createProjectRepository } from '../repositories/index.js';
import {
  createProjectSchema,
  updateProjectSchema,
  createPhaseSchema,
  updatePhaseSchema,
  createTaskSchema,
  updateTaskSchema,
  type Project,
  type ProjectPhase,
  type ProjectTask,
  type ProjectFilters,
  type PhaseFilters,
  type TaskFilters,
  type ProjectListResponse,
  type PhaseListResponse,
  type TaskListResponse,
  type CreateProjectInput,
  type UpdateProjectInput,
  type CreatePhaseInput,
  type UpdatePhaseInput,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

// ===== PROJECT ACTIONS =====

/**
 * Get a list of projects for the current tenant
 */
export async function getProjects(
  context: ActionContext,
  filters: ProjectFilters = {}
): Promise<ProjectListResponse> {
  const repo = createProjectRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get a single project by ID
 */
export async function getProject(
  context: ActionContext,
  projectId: string
): Promise<Project | null> {
  const repo = createProjectRepository(context.knex);
  return repo.findById(context.tenantId, projectId);
}

/**
 * Create a new project
 */
export async function createProject(
  context: ActionContext,
  input: CreateProjectInput
): Promise<{ success: true; project: Project } | { success: false; error: string }> {
  // Validate input
  const validation = createProjectSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createProjectRepository(context.knex);
    const project = await repo.create(context.tenantId, validation.data);
    return { success: true, project };
  } catch (error) {
    console.error('[projects/actions] Failed to create project:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create project',
    };
  }
}

/**
 * Update an existing project
 */
export async function updateProject(
  context: ActionContext,
  input: UpdateProjectInput
): Promise<{ success: true; project: Project } | { success: false; error: string }> {
  // Validate input
  const validation = updateProjectSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createProjectRepository(context.knex);
    const project = await repo.update(context.tenantId, validation.data);

    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    return { success: true, project };
  } catch (error) {
    console.error('[projects/actions] Failed to update project:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update project',
    };
  }
}

/**
 * Delete a project (soft delete)
 */
export async function deleteProject(
  context: ActionContext,
  projectId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createProjectRepository(context.knex);
    const deleted = await repo.delete(context.tenantId, projectId);

    if (!deleted) {
      return { success: false, error: 'Project not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[projects/actions] Failed to delete project:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete project',
    };
  }
}

// ===== PHASE ACTIONS =====

/**
 * Get phases for a project
 */
export async function getPhases(
  context: ActionContext,
  filters: PhaseFilters = {}
): Promise<PhaseListResponse> {
  const repo = createProjectRepository(context.knex);
  return repo.findPhases(context.tenantId, filters);
}

/**
 * Get a single phase by ID
 */
export async function getPhase(
  context: ActionContext,
  phaseId: string
): Promise<ProjectPhase | null> {
  const repo = createProjectRepository(context.knex);
  return repo.findPhaseById(context.tenantId, phaseId);
}

/**
 * Create a new phase
 */
export async function createPhase(
  context: ActionContext,
  input: CreatePhaseInput
): Promise<{ success: true; phase: ProjectPhase } | { success: false; error: string }> {
  // Validate input
  const validation = createPhaseSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createProjectRepository(context.knex);
    const phase = await repo.createPhase(context.tenantId, validation.data);
    return { success: true, phase };
  } catch (error) {
    console.error('[projects/actions] Failed to create phase:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create phase',
    };
  }
}

/**
 * Update an existing phase
 */
export async function updatePhase(
  context: ActionContext,
  input: UpdatePhaseInput
): Promise<{ success: true; phase: ProjectPhase } | { success: false; error: string }> {
  // Validate input
  const validation = updatePhaseSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createProjectRepository(context.knex);
    const phase = await repo.updatePhase(context.tenantId, validation.data);

    if (!phase) {
      return { success: false, error: 'Phase not found' };
    }

    return { success: true, phase };
  } catch (error) {
    console.error('[projects/actions] Failed to update phase:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update phase',
    };
  }
}

/**
 * Delete a phase
 */
export async function deletePhase(
  context: ActionContext,
  phaseId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createProjectRepository(context.knex);
    const deleted = await repo.deletePhase(context.tenantId, phaseId);

    if (!deleted) {
      return { success: false, error: 'Phase not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[projects/actions] Failed to delete phase:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete phase',
    };
  }
}

// ===== TASK ACTIONS =====

/**
 * Get tasks for a phase or project
 */
export async function getTasks(
  context: ActionContext,
  filters: TaskFilters = {}
): Promise<TaskListResponse> {
  const repo = createProjectRepository(context.knex);
  return repo.findTasks(context.tenantId, filters);
}

/**
 * Get a single task by ID
 */
export async function getTask(
  context: ActionContext,
  taskId: string
): Promise<ProjectTask | null> {
  const repo = createProjectRepository(context.knex);
  return repo.findTaskById(context.tenantId, taskId);
}

/**
 * Create a new task
 */
export async function createTask(
  context: ActionContext,
  input: CreateTaskInput
): Promise<{ success: true; task: ProjectTask } | { success: false; error: string }> {
  // Validate input
  const validation = createTaskSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createProjectRepository(context.knex);
    const task = await repo.createTask(context.tenantId, validation.data);
    return { success: true, task };
  } catch (error) {
    console.error('[projects/actions] Failed to create task:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create task',
    };
  }
}

/**
 * Update an existing task
 */
export async function updateTask(
  context: ActionContext,
  input: UpdateTaskInput
): Promise<{ success: true; task: ProjectTask } | { success: false; error: string }> {
  // Validate input
  const validation = updateTaskSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createProjectRepository(context.knex);
    const task = await repo.updateTask(context.tenantId, validation.data);

    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    return { success: true, task };
  } catch (error) {
    console.error('[projects/actions] Failed to update task:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update task',
    };
  }
}

/**
 * Delete a task
 */
export async function deleteTask(
  context: ActionContext,
  taskId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createProjectRepository(context.knex);
    const deleted = await repo.deleteTask(context.tenantId, taskId);

    if (!deleted) {
      return { success: false, error: 'Task not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[projects/actions] Failed to delete task:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete task',
    };
  }
}
