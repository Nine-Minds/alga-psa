/**
 * Project repository - data access layer for projects
 *
 * This repository provides database operations for projects, phases, and tasks.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  Project,
  ProjectPhase,
  ProjectTask,
  CreateProjectInput,
  UpdateProjectInput,
  CreatePhaseInput,
  UpdatePhaseInput,
  CreateTaskInput,
  UpdateTaskInput,
  ProjectFilters,
  PhaseFilters,
  TaskFilters,
  ProjectListResponse,
  PhaseListResponse,
  TaskListResponse,
} from '../types/index.js';

const PROJECTS_TABLE = 'projects';
const PHASES_TABLE = 'project_phases';
const TASKS_TABLE = 'project_tasks';
const PROJECT_TAGS_TABLE = 'project_tags';
const TASK_TAGS_TABLE = 'task_tags';

/**
 * Create the project repository with database connection
 */
export function createProjectRepository(knex: Knex) {
  return {
    // ===== PROJECT METHODS =====

    /**
     * Find a project by ID
     */
    async findById(
      tenantId: string,
      projectId: string
    ): Promise<Project | null> {
      const result = await knex(PROJECTS_TABLE)
        .where({ tenant: tenantId, project_id: projectId })
        .first();
      return result || null;
    },

    /**
     * Find projects matching filters
     */
    async findMany(
      tenantId: string,
      filters: ProjectFilters = {}
    ): Promise<ProjectListResponse> {
      const {
        search,
        client_id,
        status,
        is_inactive,
        assigned_to,
        tags,
        start_date_from,
        start_date_to,
        end_date_from,
        end_date_to,
        limit = 50,
        offset = 0,
        orderBy = 'created_at',
        orderDirection = 'desc',
      } = filters;

      let query = knex(PROJECTS_TABLE).where({ tenant: tenantId });

      // Apply search filter
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('project_name', `%${search}%`)
            .orWhereILike('description', `%${search}%`)
            .orWhereILike('wbs_code', `%${search}%`);
        });
      }

      // Apply client filter
      if (client_id) {
        query = query.where({ client_id });
      }

      // Apply status filter
      if (status) {
        query = query.where({ status });
      }

      // Apply inactive filter
      if (is_inactive !== undefined) {
        query = query.where({ is_inactive });
      }

      // Apply assigned_to filter
      if (assigned_to) {
        query = query.where({ assigned_to });
      }

      // Apply date range filters
      if (start_date_from) {
        query = query.where('start_date', '>=', start_date_from);
      }
      if (start_date_to) {
        query = query.where('start_date', '<=', start_date_to);
      }
      if (end_date_from) {
        query = query.where('end_date', '>=', end_date_from);
      }
      if (end_date_to) {
        query = query.where('end_date', '<=', end_date_to);
      }

      // Apply tag filter
      if (tags && tags.length > 0) {
        query = query
          .join(PROJECT_TAGS_TABLE, `${PROJECTS_TABLE}.project_id`, `${PROJECT_TAGS_TABLE}.project_id`)
          .whereIn(`${PROJECT_TAGS_TABLE}.tag_id`, tags);
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const projects = await query
        .select(`${PROJECTS_TABLE}.*`)
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      return { projects, total, limit, offset };
    },

    /**
     * Create a new project
     */
    async create(
      tenantId: string,
      input: CreateProjectInput
    ): Promise<Project> {
      const { tags, ...projectData } = input;

      const [project] = await knex(PROJECTS_TABLE)
        .insert({
          ...projectData,
          tenant: tenantId,
          is_inactive: false,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      // Associate tags if provided
      if (tags && tags.length > 0) {
        await knex(PROJECT_TAGS_TABLE).insert(
          tags.map((tagId) => ({
            project_id: project.project_id,
            tag_id: tagId,
            tenant: tenantId,
          }))
        );
      }

      return project;
    },

    /**
     * Update an existing project
     */
    async update(
      tenantId: string,
      input: UpdateProjectInput
    ): Promise<Project | null> {
      const { project_id, tags, ...updateData } = input;

      const [project] = await knex(PROJECTS_TABLE)
        .where({ tenant: tenantId, project_id })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      if (!project) {
        return null;
      }

      // Update tags if provided
      if (tags !== undefined) {
        // Remove existing tags
        await knex(PROJECT_TAGS_TABLE)
          .where({ project_id, tenant: tenantId })
          .delete();

        // Add new tags
        if (tags.length > 0) {
          await knex(PROJECT_TAGS_TABLE).insert(
            tags.map((tagId) => ({
              project_id,
              tag_id: tagId,
              tenant: tenantId,
            }))
          );
        }
      }

      return project;
    },

    /**
     * Delete a project (soft delete by setting is_inactive)
     */
    async delete(tenantId: string, projectId: string): Promise<boolean> {
      const result = await knex(PROJECTS_TABLE)
        .where({ tenant: tenantId, project_id: projectId })
        .update({ is_inactive: true, updated_at: new Date() });

      return result > 0;
    },

    /**
     * Hard delete a project (permanent)
     */
    async hardDelete(tenantId: string, projectId: string): Promise<boolean> {
      // Delete tags first
      await knex(PROJECT_TAGS_TABLE)
        .where({ project_id: projectId, tenant: tenantId })
        .delete();

      const result = await knex(PROJECTS_TABLE)
        .where({ tenant: tenantId, project_id: projectId })
        .delete();

      return result > 0;
    },

    // ===== PHASE METHODS =====

    /**
     * Find a phase by ID
     */
    async findPhaseById(
      tenantId: string,
      phaseId: string
    ): Promise<ProjectPhase | null> {
      const result = await knex(PHASES_TABLE)
        .where({ tenant: tenantId, phase_id: phaseId })
        .first();
      return result || null;
    },

    /**
     * Find phases matching filters
     */
    async findPhases(
      tenantId: string,
      filters: PhaseFilters = {}
    ): Promise<PhaseListResponse> {
      const {
        project_id,
        status,
        limit = 50,
        offset = 0,
      } = filters;

      let query = knex(PHASES_TABLE).where({ tenant: tenantId });

      if (project_id) {
        query = query.where({ project_id });
      }

      if (status) {
        query = query.where({ status });
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const phases = await query
        .orderBy('order_number', 'asc')
        .limit(limit)
        .offset(offset);

      return { phases, total, limit, offset };
    },

    /**
     * Create a new phase
     */
    async createPhase(
      tenantId: string,
      input: CreatePhaseInput
    ): Promise<ProjectPhase> {
      const [phase] = await knex(PHASES_TABLE)
        .insert({
          ...input,
          tenant: tenantId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      return phase;
    },

    /**
     * Update an existing phase
     */
    async updatePhase(
      tenantId: string,
      input: UpdatePhaseInput
    ): Promise<ProjectPhase | null> {
      const { phase_id, ...updateData } = input;

      const [phase] = await knex(PHASES_TABLE)
        .where({ tenant: tenantId, phase_id })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      return phase || null;
    },

    /**
     * Delete a phase
     */
    async deletePhase(tenantId: string, phaseId: string): Promise<boolean> {
      const result = await knex(PHASES_TABLE)
        .where({ tenant: tenantId, phase_id: phaseId })
        .delete();

      return result > 0;
    },

    // ===== TASK METHODS =====

    /**
     * Find a task by ID
     */
    async findTaskById(
      tenantId: string,
      taskId: string
    ): Promise<ProjectTask | null> {
      const result = await knex(TASKS_TABLE)
        .where({ tenant: tenantId, task_id: taskId })
        .first();
      return result || null;
    },

    /**
     * Find tasks matching filters
     */
    async findTasks(
      tenantId: string,
      filters: TaskFilters = {}
    ): Promise<TaskListResponse> {
      const {
        phase_id,
        project_id,
        assigned_to,
        status,
        task_type_key,
        tags,
        due_date_from,
        due_date_to,
        limit = 50,
        offset = 0,
      } = filters;

      let query = knex(TASKS_TABLE).where({ [`${TASKS_TABLE}.tenant`]: tenantId });

      if (phase_id) {
        query = query.where({ phase_id });
      }

      if (project_id) {
        query = query
          .join(PHASES_TABLE, `${TASKS_TABLE}.phase_id`, `${PHASES_TABLE}.phase_id`)
          .where({ [`${PHASES_TABLE}.project_id`]: project_id });
      }

      if (assigned_to) {
        query = query.where({ [`${TASKS_TABLE}.assigned_to`]: assigned_to });
      }

      if (status) {
        query = query.where({ [`${TASKS_TABLE}.project_status_mapping_id`]: status });
      }

      if (task_type_key) {
        query = query.where({ task_type_key });
      }

      if (due_date_from) {
        query = query.where('due_date', '>=', due_date_from);
      }

      if (due_date_to) {
        query = query.where('due_date', '<=', due_date_to);
      }

      // Apply tag filter
      if (tags && tags.length > 0) {
        query = query
          .join(TASK_TAGS_TABLE, `${TASKS_TABLE}.task_id`, `${TASK_TAGS_TABLE}.task_id`)
          .whereIn(`${TASK_TAGS_TABLE}.tag_id`, tags);
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const tasks = await query
        .select(`${TASKS_TABLE}.*`)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      return { tasks, total, limit, offset };
    },

    /**
     * Create a new task
     */
    async createTask(
      tenantId: string,
      input: CreateTaskInput
    ): Promise<ProjectTask> {
      const { tags, ...taskData } = input;

      const [task] = await knex(TASKS_TABLE)
        .insert({
          ...taskData,
          tenant: tenantId,
          actual_hours: 0,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      // Associate tags if provided
      if (tags && tags.length > 0) {
        await knex(TASK_TAGS_TABLE).insert(
          tags.map((tagId) => ({
            task_id: task.task_id,
            tag_id: tagId,
            tenant: tenantId,
          }))
        );
      }

      return task;
    },

    /**
     * Update an existing task
     */
    async updateTask(
      tenantId: string,
      input: UpdateTaskInput
    ): Promise<ProjectTask | null> {
      const { task_id, tags, ...updateData } = input;

      const [task] = await knex(TASKS_TABLE)
        .where({ tenant: tenantId, task_id })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      if (!task) {
        return null;
      }

      // Update tags if provided
      if (tags !== undefined) {
        // Remove existing tags
        await knex(TASK_TAGS_TABLE)
          .where({ task_id, tenant: tenantId })
          .delete();

        // Add new tags
        if (tags.length > 0) {
          await knex(TASK_TAGS_TABLE).insert(
            tags.map((tagId) => ({
              task_id,
              tag_id: tagId,
              tenant: tenantId,
            }))
          );
        }
      }

      return task;
    },

    /**
     * Delete a task
     */
    async deleteTask(tenantId: string, taskId: string): Promise<boolean> {
      // Delete tags first
      await knex(TASK_TAGS_TABLE)
        .where({ task_id: taskId, tenant: tenantId })
        .delete();

      const result = await knex(TASKS_TABLE)
        .where({ tenant: tenantId, task_id: taskId })
        .delete();

      return result > 0;
    },
  };
}

// Default export for convenience when used with dependency injection
export const projectRepository = {
  create: createProjectRepository,
};
