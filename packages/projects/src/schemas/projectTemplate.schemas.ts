import { z } from 'zod';
import { tenantSchema } from '@alga-psa/validation';
import { clientPortalConfigSchema } from './project.schemas';
import { partialWithoutDefaults } from '@alga-psa/validation/lib/partialWithoutDefaults';

export const projectTemplateSchema = tenantSchema.extend({
  template_id: z.string().guid(),
  template_name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  created_by: z.string().guid(),
  created_at: z.date(),
  updated_at: z.date().nullable().optional(),
  use_count: z.number().int().min(0),
  last_used_at: z.date().nullable().optional(),
  client_portal_config: clientPortalConfigSchema.optional()
});

export const projectTemplatePhaseSchema = tenantSchema.extend({
  template_phase_id: z.string().guid(),
  template_id: z.string().guid(),
  phase_name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  duration_days: z.number().int().positive().nullable().optional(),
  start_offset_days: z.number().int().min(0).default(0),
  order_key: z.string().nullable().optional()
});

export const projectTemplateTaskSchema = tenantSchema.extend({
  template_task_id: z.string().guid(),
  template_phase_id: z.string().guid(),
  task_name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  description_rich_text: z.string().nullable().optional(),
  estimated_hours: z.number().positive().nullable().optional(),
  duration_days: z.number().int().positive().nullable().optional(),
  start_offset_days: z.number().int().min(0).nullable().optional(),
  task_type_key: z.string().max(50).nullable().optional(),
  priority_id: z.string().guid().nullable().optional(),
  order_key: z.string().nullable().optional()
});

export const projectTemplateDependencySchema = tenantSchema.extend({
  template_dependency_id: z.string().guid(),
  template_id: z.string().guid(),
  predecessor_task_id: z.string().guid(),
  successor_task_id: z.string().guid(),
  dependency_type: z.enum(['blocks', 'blocked_by', 'related_to']),
  lead_lag_days: z.number().int().default(0),
  notes: z.string().nullable().optional()
});

export const projectTemplateChecklistItemSchema = tenantSchema.extend({
  template_checklist_id: z.string().guid(),
  template_task_id: z.string().guid(),
  item_name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  order_number: z.number().int().min(1)
});

export const projectTemplateStatusMappingSchema = tenantSchema.extend({
  template_status_mapping_id: z.string().guid(),
  template_id: z.string().guid(),
  status_id: z.string().guid().nullable().optional(),
  custom_status_name: z.string().max(100).nullable().optional(),
  display_order: z.number().int().min(1)
});

// Input schemas
export const createTemplateSchema = projectTemplateSchema.omit({
  template_id: true,
  created_at: true,
  updated_at: true,
  use_count: true,
  last_used_at: true,
  tenant: true,
  created_by: true
});

export const updateTemplateSchema = partialWithoutDefaults(createTemplateSchema);

export const applyTemplateSchema = z.object({
  template_id: z.string().guid(),
  project_name: z.string().min(1).max(255),
  client_id: z.string().guid(),
  start_date: z.preprocess(
    (val) => {
      if (val === '' || val === null || val === undefined) return undefined;
      // If it's a date-only string (YYYY-MM-DD), convert to datetime string
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        return `${val}T00:00:00.000Z`;
      }
      return val;
    },
    z.string().datetime().optional()
  ),
  assigned_to: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? undefined : val,
    z.string().guid().optional()
  ),
  status_id: z.preprocess(
    (val) => val === '' || val === null || val === undefined ? undefined : val,
    z.string().guid().optional()
  ),
  options: z.object({
    copyPhases: z.boolean().default(true),
    copyStatuses: z.boolean().default(true),
    copyTasks: z.boolean().default(true),
    copyDependencies: z.boolean().default(true),
    copyChecklists: z.boolean().default(true),
    copyServices: z.boolean().default(true),
    assignmentOption: z.enum(['none', 'primary', 'all']).default('primary')
  }).optional()
});
