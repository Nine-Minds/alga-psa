import { z } from 'zod';

/**
 * Project entity representing a project in the PSA system
 */
export interface Project {
  project_id: string;
  tenant: string;
  client_id: string;
  project_name: string;
  description: string | null;
  start_date: Date | null;
  end_date: Date | null;
  status: string;
  wbs_code: string;
  is_inactive: boolean;
  created_at: Date;
  updated_at: Date;
  assigned_to?: string | null;
  contact_name_id?: string | null;
  budgeted_hours?: number | null;
  project_number: string;
  // Joined fields
  client_name?: string;
  status_name?: string;
  is_closed?: boolean;
  contact_name?: string | null;
  tags?: string[];
}

/**
 * Project phase entity
 */
export interface ProjectPhase {
  phase_id: string;
  tenant: string;
  project_id: string;
  phase_name: string;
  description: string | null;
  start_date: Date | null;
  end_date: Date | null;
  status: string;
  order_number: number;
  order_key?: string;
  wbs_code: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Project task entity
 */
export interface ProjectTask {
  task_id: string;
  tenant: string;
  phase_id: string;
  task_name: string;
  description: string | null;
  assigned_to: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  project_status_mapping_id: string;
  wbs_code: string;
  order_key?: string;
  due_date: Date | null;
  priority_id?: string | null;
  task_type_key: string;
  created_at: Date;
  updated_at: Date;
  tags?: string[];
}

/**
 * Project status mapping
 */
export interface ProjectStatusMapping {
  project_status_mapping_id: string;
  tenant: string;
  project_id: string;
  status_id?: string;
  standard_status_id?: string;
  is_standard: boolean;
  custom_name: string | null;
  display_order: number;
  is_visible: boolean;
  status_name?: string;
  name?: string;
  is_closed?: boolean;
}

/**
 * Project status type
 */
export type ProjectStatus = {
  project_status_mapping_id: string;
  status_id: string;
  name: string;
  custom_name: string | null;
  is_visible: boolean;
  display_order: number;
  is_standard: boolean;
  is_closed: boolean;
  standard_status_id?: string;
  color?: string | null;
  icon?: string | null;
};

/**
 * Task checklist item
 */
export interface TaskChecklistItem {
  checklist_item_id: string;
  tenant: string;
  task_id: string;
  item_name: string;
  description: string | null;
  assigned_to: string | null;
  completed: boolean;
  due_date: Date | null;
  order_number: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Project ticket link
 */
export interface ProjectTicketLink {
  link_id: string;
  tenant: string;
  project_id: string;
  phase_id: string | null;
  task_id: string | null;
  ticket_id: string;
  created_at: Date;
}

/**
 * Dependency types for tasks
 */
export type DependencyType = 'blocks' | 'blocked_by' | 'related_to';

/**
 * Project task dependency
 */
export interface ProjectTaskDependency {
  dependency_id: string;
  tenant: string;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: DependencyType;
  lead_lag_days: number;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Input schema for creating a new project
 */
export const createProjectSchema = z.object({
  client_id: z.string().uuid('Invalid client ID'),
  project_name: z.string().min(1, 'Project name is required').max(255),
  description: z.string().nullable().optional(),
  start_date: z.coerce.date().nullable().optional(),
  end_date: z.coerce.date().nullable().optional(),
  status: z.string().max(50).default('Planning'),
  wbs_code: z.string().max(50).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  contact_name_id: z.string().uuid().nullable().optional(),
  budgeted_hours: z.number().positive().nullable().optional(),
  tags: z.array(z.string().uuid()).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * Input schema for updating an existing project
 */
export const updateProjectSchema = createProjectSchema.partial().extend({
  project_id: z.string().uuid(),
  is_inactive: z.boolean().optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/**
 * Input schema for creating a project phase
 */
export const createPhaseSchema = z.object({
  project_id: z.string().uuid(),
  phase_name: z.string().min(1, 'Phase name is required').max(255),
  description: z.string().nullable().optional(),
  start_date: z.coerce.date().nullable().optional(),
  end_date: z.coerce.date().nullable().optional(),
  status: z.string().max(50).default('Not Started'),
  order_number: z.number().int().nonnegative().default(0),
});

export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;

/**
 * Input schema for updating a project phase
 */
export const updatePhaseSchema = createPhaseSchema.partial().extend({
  phase_id: z.string().uuid(),
});

export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;

/**
 * Input schema for creating a project task
 */
export const createTaskSchema = z.object({
  phase_id: z.string().uuid(),
  task_name: z.string().min(1, 'Task name is required').max(255),
  description: z.string().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  estimated_hours: z.number().positive().nullable().optional(),
  project_status_mapping_id: z.string().uuid(),
  due_date: z.coerce.date().nullable().optional(),
  priority_id: z.string().uuid().nullable().optional(),
  task_type_key: z.string().max(50).default('task'),
  tags: z.array(z.string().uuid()).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Input schema for updating a project task
 */
export const updateTaskSchema = createTaskSchema.partial().extend({
  task_id: z.string().uuid(),
  actual_hours: z.number().nonnegative().nullable().optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Filters for querying projects
 */
export interface ProjectFilters {
  search?: string;
  client_id?: string;
  status?: string;
  is_inactive?: boolean;
  assigned_to?: string;
  tags?: string[];
  start_date_from?: Date;
  start_date_to?: Date;
  end_date_from?: Date;
  end_date_to?: Date;
  limit?: number;
  offset?: number;
  orderBy?: keyof Project;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Filters for querying project phases
 */
export interface PhaseFilters {
  project_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Filters for querying project tasks
 */
export interface TaskFilters {
  phase_id?: string;
  project_id?: string;
  assigned_to?: string;
  status?: string;
  task_type_key?: string;
  tags?: string[];
  due_date_from?: Date;
  due_date_to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Paginated response for project queries
 */
export interface ProjectListResponse {
  projects: Project[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Paginated response for phase queries
 */
export interface PhaseListResponse {
  phases: ProjectPhase[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Paginated response for task queries
 */
export interface TaskListResponse {
  tasks: ProjectTask[];
  total: number;
  limit: number;
  offset: number;
}
