/**
 * Project API Schemas
 * Validation schemas for project-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema
} from './common';

// Project status schema - can be UUID or status name
export const projectStatusSchema = z.union([
  uuidSchema,
  z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled', 'in_progress'])
]);

// Create project schema
export const createProjectSchema = z.object({
  client_id: uuidSchema,
  project_name: z.string().min(1, 'Project name is required').max(255),
  description: z.string().optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  wbs_code: z.string().optional(),
  is_inactive: z.boolean().optional().default(false),
  status: projectStatusSchema.optional(),
  assigned_to: uuidSchema.optional(),
  contact_name_id: uuidSchema.optional(),
  budgeted_hours: z.number().min(0).optional(),
  tags: z.array(z.string()).optional(),
  create_default_phase: z.boolean().optional().default(false)
});

// Update project schema (all fields optional)
export const updateProjectSchema = createUpdateSchema(createProjectSchema);

// Project filter schema
export const projectFilterSchema = baseFilterSchema.extend({
  project_name: z.string().optional(),
  client_id: uuidSchema.optional(),
  status: projectStatusSchema.optional(),
  assigned_to: uuidSchema.optional(),
  contact_name_id: uuidSchema.optional(),
  is_inactive: booleanTransform.optional(),
  is_closed: booleanTransform.optional(),
  has_assignment: booleanTransform.optional(),
  start_date_from: dateSchema.optional(),
  start_date_to: dateSchema.optional(),
  end_date_from: dateSchema.optional(),
  end_date_to: dateSchema.optional(),
  budgeted_hours_min: z.string().transform(val => parseFloat(val)).optional(),
  budgeted_hours_max: z.string().transform(val => parseFloat(val)).optional(),
  client_name: z.string().optional(),
  contact_name: z.string().optional(),
  wbs_code: z.string().optional()
});

// Project list query schema
export const projectListQuerySchema = createListQuerySchema(projectFilterSchema);

// Project response schema
export const projectResponseSchema = z.object({
  project_id: uuidSchema,
  client_id: uuidSchema,
  project_name: z.string(),
  description: z.string().nullable(),
  start_date: dateSchema.nullable(),
  end_date: dateSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  wbs_code: z.string(),
  is_inactive: z.boolean(),
  status: projectStatusSchema,
  assigned_to: uuidSchema.nullable(),
  contact_name_id: uuidSchema.nullable(),
  budgeted_hours: z.number().nullable(),
  tenant: uuidSchema,
  tags: z.array(z.string()).optional(),
  
  // Computed/joined fields
  client_name: z.string().optional(),
  status_name: z.string().optional(),
  is_closed: z.boolean().optional(),
  contact_name: z.string().optional()
});

// Project with details response schema
export const projectWithDetailsResponseSchema = projectResponseSchema.extend({
  client: z.object({
    client_id: uuidSchema,
    client_name: z.string(),
    email: z.string().nullable(),
    phone_no: z.string().nullable()
  }).optional(),
  
  contact: z.object({
    contact_name_id: uuidSchema,
    full_name: z.string(),
    email: z.string(),
    phone_number: z.string().nullable()
  }).optional(),
  
  assigned_user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional(),
  
  phases: z.array(z.object({
    phase_id: uuidSchema,
    phase_name: z.string(),
    description: z.string().nullable(),
    start_date: dateSchema.nullable(),
    end_date: dateSchema.nullable(),
    status: z.string(),
    order_number: z.number(),
    wbs_code: z.string()
  })).optional(),
  
  statistics: z.object({
    total_phases: z.number(),
    total_tasks: z.number(),
    completed_tasks: z.number(),
    total_estimated_hours: z.number(),
    total_actual_hours: z.number(),
    progress_percentage: z.number()
  }).optional()
});

// Project phase schemas
export const createProjectPhaseSchema = z.object({
  phase_name: z.string().min(1, 'Phase name is required').max(255),
  description: z.string().optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  status: z.string().optional().default('planning'),
  order_number: z.number().min(0).optional(),
  wbs_code: z.string().optional()
});

export const updateProjectPhaseSchema = createUpdateSchema(createProjectPhaseSchema);

export const projectPhaseResponseSchema = z.object({
  phase_id: uuidSchema,
  project_id: uuidSchema,
  phase_name: z.string(),
  description: z.string().nullable(),
  start_date: dateSchema.nullable(),
  end_date: dateSchema.nullable(),
  status: z.string(),
  order_number: z.number(),
  order_key: z.string().optional(),
  wbs_code: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  tasks: z.array(z.object({
    task_id: uuidSchema,
    task_name: z.string(),
    description: z.string().nullable(),
    assigned_to: uuidSchema.nullable(),
    estimated_hours: z.number().nullable(),
    actual_hours: z.number().nullable(),
    due_date: dateSchema.nullable(),
    status: z.string(),
    wbs_code: z.string()
  })).optional()
});

// Project task schemas
export const createProjectTaskSchema = z.object({
  task_name: z.string().min(1, 'Task name is required').max(255),
  description: z.string().optional(),
  assigned_to: uuidSchema.optional(),
  estimated_hours: z.number().min(0).optional(),
  due_date: dateSchema.optional(),
  priority_id: uuidSchema.optional(),
  task_type_key: z.string().optional().default('general'),
  project_status_mapping_id: uuidSchema,
  wbs_code: z.string().optional(),
  tags: z.array(z.string()).optional()
});

export const updateProjectTaskSchema = createUpdateSchema(createProjectTaskSchema);

export const projectTaskResponseSchema = z.object({
  task_id: uuidSchema,
  phase_id: uuidSchema,
  task_name: z.string(),
  description: z.string().nullable(),
  assigned_to: uuidSchema.nullable(),
  estimated_hours: z.number().nullable(),
  actual_hours: z.number().nullable(),
  project_status_mapping_id: uuidSchema,
  due_date: dateSchema.nullable(),
  priority_id: uuidSchema.nullable(),
  task_type_key: z.string(),
  wbs_code: z.string(),
  order_key: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  tags: z.array(z.string()).optional(),
  
  // Joined fields
  assigned_user_name: z.string().optional(),
  priority_name: z.string().optional(),
  status_name: z.string().optional()
});

// Project task checklist schemas
export const createTaskChecklistItemSchema = z.object({
  item_text: z.string().min(1, 'Item text is required'),
  is_completed: z.boolean().optional().default(false),
  order_number: z.number().min(0).optional()
});

export const updateTaskChecklistItemSchema = z.object({
  item_text: z.string().optional(),
  is_completed: z.boolean().optional(),
  order_number: z.number().min(0).optional()
});

export const taskChecklistItemResponseSchema = z.object({
  checklist_item_id: uuidSchema,
  task_id: uuidSchema,
  item_text: z.string(),
  is_completed: z.boolean(),
  order_number: z.number(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

// Project ticket link schemas
export const createProjectTicketLinkSchema = z.object({
  ticket_id: uuidSchema,
  link_type: z.enum(['blocks', 'blocked_by', 'related', 'duplicate']).optional().default('related'),
  notes: z.string().optional()
});

export const projectTicketLinkResponseSchema = z.object({
  link_id: uuidSchema,
  project_id: uuidSchema,
  task_id: uuidSchema.nullable(),
  ticket_id: uuidSchema,
  link_type: z.string(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Joined ticket details
  ticket: z.object({
    ticket_id: uuidSchema,
    ticket_number: z.string(),
    title: z.string(),
    status_name: z.string(),
    priority_name: z.string(),
    client_name: z.string()
  }).optional()
});

// Bulk operations schemas
export const bulkUpdateProjectSchema = z.object({
  projects: z.array(z.object({
    project_id: uuidSchema,
    data: updateProjectSchema
  })).min(1).max(50)
});

export const bulkAssignProjectSchema = z.object({
  project_ids: z.array(uuidSchema).min(1).max(50),
  assigned_to: uuidSchema.optional()
});

export const bulkStatusUpdateSchema = z.object({
  project_ids: z.array(uuidSchema).min(1).max(50),
  status: projectStatusSchema
});

// Project statistics schema
export const projectStatsResponseSchema = z.object({
  total_projects: z.number(),
  active_projects: z.number(),
  completed_projects: z.number(),
  on_hold_projects: z.number(),
  cancelled_projects: z.number(),
  overdue_projects: z.number(),
  projects_by_status: z.record(z.number()),
  projects_by_client: z.record(z.number()),
  total_budgeted_hours: z.number(),
  total_actual_hours: z.number(),
  average_project_duration: z.number().nullable(),
  projects_created_this_month: z.number(),
  projects_completed_this_month: z.number()
});

// Project search schema
export const projectSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: z.array(z.enum(['project_name', 'description', 'wbs_code', 'client_name'])).optional(),
  status: z.array(projectStatusSchema).optional(),
  client_ids: z.array(uuidSchema).optional(),
  assigned_to_ids: z.array(uuidSchema).optional(),
  include_inactive: booleanTransform.optional().default("false"),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25')
});

// Project export schema
export const projectExportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional().default('csv'),
  include_inactive: booleanTransform.optional().default("false"),
  include_phases: booleanTransform.optional().default("false"),
  include_tasks: booleanTransform.optional().default("false"),
  status: z.array(projectStatusSchema).optional(),
  client_ids: z.array(uuidSchema).optional(),
  fields: z.array(z.string()).optional()
});

// Project template schemas
export const createProjectTemplateSchema = z.object({
  template_name: z.string().min(1, 'Template name is required'),
  description: z.string().optional(),
  default_phases: z.array(z.object({
    phase_name: z.string(),
    description: z.string().optional(),
    estimated_duration_days: z.number().optional(),
    default_tasks: z.array(z.object({
      task_name: z.string(),
      description: z.string().optional(),
      estimated_hours: z.number().optional(),
      task_type_key: z.string().optional()
    })).optional()
  })).optional()
});

export const projectTemplateResponseSchema = z.object({
  template_id: uuidSchema,
  template_name: z.string(),
  description: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  phases: z.array(z.object({
    phase_name: z.string(),
    description: z.string().nullable(),
    estimated_duration_days: z.number().nullable(),
    tasks: z.array(z.object({
      task_name: z.string(),
      description: z.string().nullable(),
      estimated_hours: z.number().nullable(),
      task_type_key: z.string()
    }))
  }))
});

// Export types for TypeScript
export type CreateProjectData = z.infer<typeof createProjectSchema>;
export type UpdateProjectData = z.infer<typeof updateProjectSchema>;
export type ProjectFilterData = z.infer<typeof projectFilterSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type ProjectWithDetailsResponse = z.infer<typeof projectWithDetailsResponseSchema>;
export type CreateProjectPhaseData = z.infer<typeof createProjectPhaseSchema>;
export type UpdateProjectPhaseData = z.infer<typeof updateProjectPhaseSchema>;
export type ProjectPhaseResponse = z.infer<typeof projectPhaseResponseSchema>;
export type CreateProjectTaskData = z.infer<typeof createProjectTaskSchema>;
export type UpdateProjectTaskData = z.infer<typeof updateProjectTaskSchema>;
export type ProjectTaskResponse = z.infer<typeof projectTaskResponseSchema>;
export type CreateTaskChecklistItemData = z.infer<typeof createTaskChecklistItemSchema>;
export type TaskChecklistItemResponse = z.infer<typeof taskChecklistItemResponseSchema>;
export type CreateProjectTicketLinkData = z.infer<typeof createProjectTicketLinkSchema>;
export type ProjectTicketLinkResponse = z.infer<typeof projectTicketLinkResponseSchema>;
export type ProjectSearchData = z.infer<typeof projectSearchSchema>;
export type ProjectExportQuery = z.infer<typeof projectExportQuerySchema>;
export type CreateProjectTemplateData = z.infer<typeof createProjectTemplateSchema>;
export type ProjectTemplateResponse = z.infer<typeof projectTemplateResponseSchema>;