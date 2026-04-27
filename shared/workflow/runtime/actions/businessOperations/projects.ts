import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  uuidSchema,
  isoDateTimeSchema,
  actionProvidedKey,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError,
  rethrowAsStandardError,
  type TenantTxContext,
} from './shared';

const WORKFLOW_PICKER_HINTS = {
  project: 'Search projects',
  'project-phase': 'Search project phases',
  'project-task': 'Search project tasks',
  'project-task-status': 'Search project task statuses',
  ticket: 'Search tickets',
  user: 'Search users',
} as const;

const withWorkflowPicker = <T extends z.ZodTypeAny>(
  schema: T,
  description: string,
  kind: keyof typeof WORKFLOW_PICKER_HINTS,
  dependencies?: string[]
): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-picker-kind': kind,
    'x-workflow-picker-dependencies': dependencies,
    'x-workflow-picker-fixed-value-hint': WORKFLOW_PICKER_HINTS[kind],
    'x-workflow-picker-allow-dynamic-reference': true,
  });

const nullableUuidSchema = z.union([uuidSchema, z.null()]);

const projectSummarySchema = z.object({
  project_id: uuidSchema,
  project_name: z.string(),
  description: z.string().nullable(),
  client_id: nullableUuidSchema,
  status: z.string().nullable(),
  assigned_to: nullableUuidSchema,
  wbs_code: z.string().nullable(),
  updated_at: isoDateTimeSchema.optional(),
});

const phaseSummarySchema = z.object({
  phase_id: uuidSchema,
  project_id: uuidSchema,
  phase_name: z.string(),
  description: z.string().nullable(),
  status: z.string().nullable(),
  order_number: z.number().int().nullable(),
  order_key: z.string().nullable(),
  wbs_code: z.string().nullable(),
  updated_at: isoDateTimeSchema.optional(),
});

const taskSummarySchema = z.object({
  task_id: uuidSchema,
  project_id: uuidSchema,
  phase_id: uuidSchema,
  task_name: z.string(),
  description: z.string().nullable(),
  assigned_to: nullableUuidSchema,
  status_id: nullableUuidSchema,
  project_status_mapping_id: nullableUuidSchema,
  wbs_code: z.string().nullable(),
  order_key: z.string().nullable(),
  updated_at: isoDateTimeSchema.optional(),
});

const statusMappingSummarySchema = z.object({
  project_status_mapping_id: uuidSchema,
  project_id: uuidSchema,
  phase_id: nullableUuidSchema.optional(),
  status_id: nullableUuidSchema,
  standard_status_id: nullableUuidSchema,
  custom_name: z.string().nullable(),
  display_order: z.number().int().nullable(),
  is_visible: z.boolean().nullable(),
  is_standard: z.boolean().nullable(),
});

const tagResultSchema = z.object({
  tag_id: uuidSchema,
  tag_text: z.string(),
  mapping_id: uuidSchema.optional(),
});

const assignmentResultSchema = z.object({
  task_id: uuidSchema,
  assigned_to: nullableUuidSchema,
  additional_user_ids: z.array(uuidSchema),
  no_op: z.boolean(),
  updated_at: isoDateTimeSchema,
});

const linkResultSchema = z.object({
  task_id: uuidSchema,
  ticket_id: uuidSchema,
  project_ticket_link_created: z.boolean(),
  ticket_entity_link_created: z.boolean(),
});

const statusMappingOrStatusPicker = withWorkflowPicker(
  uuidSchema,
  'Project task status mapping id',
  'project-task-status',
  ['project_id', 'phase_id']
);

const projectUpdatePatchSchema = z.object({
  project_name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
}).superRefine((value, refinementCtx) => {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'patch must include at least one editable field' });
    return;
  }
  const hasDefined = keys.some((key) => (value as Record<string, unknown>)[key] !== undefined);
  if (!hasDefined) {
    refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'patch must include at least one defined value' });
  }
});

const phaseUpdatePatchSchema = z.object({
  phase_name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
}).superRefine((value, refinementCtx) => {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'patch must include at least one editable field' });
    return;
  }
  const hasDefined = keys.some((key) => (value as Record<string, unknown>)[key] !== undefined);
  if (!hasDefined) {
    refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'patch must include at least one defined value' });
  }
});

const taskUpdatePatchSchema = z.object({
  task_name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
}).superRefine((value, refinementCtx) => {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'patch must include at least one editable field' });
    return;
  }
  const hasDefined = keys.some((key) => (value as Record<string, unknown>)[key] !== undefined);
  if (!hasDefined) {
    refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'patch must include at least one defined value' });
  }
});

const moveTaskInputSchema = z.object({
  task_id: withWorkflowPicker(uuidSchema, 'Project task id', 'project-task', ['target_project_id', 'target_phase_id']),
  target_phase_id: withWorkflowPicker(uuidSchema, 'Target project phase id', 'project-phase', ['target_project_id']),
  target_project_status_mapping_id: withWorkflowPicker(
    uuidSchema.optional(),
    'Optional target status mapping id',
    'project-task-status',
    ['target_project_id', 'target_phase_id']
  ),
  target_project_id: withWorkflowPicker(uuidSchema.optional(), 'Optional target project id', 'project'),
  before_task_id: withWorkflowPicker(uuidSchema.optional(), 'Optional task id to position before', 'project-task', ['target_project_id', 'target_phase_id']),
  after_task_id: withWorkflowPicker(uuidSchema.optional(), 'Optional task id to position after', 'project-task', ['target_project_id', 'target_phase_id']),
}).superRefine((value, refinementCtx) => {
  if (value.before_task_id && value.after_task_id) {
    refinementCtx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'before_task_id and after_task_id are mutually exclusive',
      path: ['before_task_id'],
    });
  }
});

const PROJECT_TABLE_AUTH_COLUMNS = ['project_id', 'client_id', 'assigned_to'] as const;

type ProjectAuthRecord = {
  project_id: string;
  client_id: string | null;
  assigned_to: string | null;
};

const updateResultSchema = z.object({
  changed_fields: z.array(z.string()),
  no_op: z.boolean(),
  updated_at: isoDateTimeSchema,
});

const moveTaskResultSchema = z.object({
  task_id: uuidSchema,
  previous_project_id: uuidSchema,
  previous_phase_id: uuidSchema,
  previous_project_status_mapping_id: nullableUuidSchema,
  previous_status_id: nullableUuidSchema,
  current_project_id: uuidSchema,
  current_phase_id: uuidSchema,
  current_project_status_mapping_id: nullableUuidSchema,
  current_status_id: nullableUuidSchema,
  wbs_code: z.string().nullable(),
  order_key: z.string().nullable(),
  updated_at: isoDateTimeSchema,
});

const assignTaskInputSchema = z.object({
  task_id: withWorkflowPicker(uuidSchema, 'Project task id', 'project-task', ['project_id', 'phase_id']),
  primary_user_id: withWorkflowPicker(uuidSchema, 'Primary assigned user id', 'user'),
  additional_user_ids: withWorkflowPicker(z.array(uuidSchema).default([]), 'Additional assigned user ids', 'user'),
  reason: z.string().min(1).max(1000).optional().describe('Optional assignment reason'),
  no_op_if_already_assigned: z.boolean().default(true),
  idempotency_key: z.string().min(1).max(255).optional(),
}).superRefine((value, refinementCtx) => {
  const additional = value.additional_user_ids ?? [];
  if (additional.includes(value.primary_user_id)) {
    refinementCtx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['additional_user_ids'],
      message: 'additional_user_ids must not include primary_user_id',
    });
  }
});

const duplicateTaskInputSchema = z.object({
  source_task_id: withWorkflowPicker(uuidSchema, 'Source project task id', 'project-task', ['project_id', 'phase_id']),
  target_phase_id: withWorkflowPicker(uuidSchema, 'Target project phase id', 'project-phase', ['target_project_id']),
  target_project_status_mapping_id: withWorkflowPicker(
    uuidSchema.optional(),
    'Optional target status mapping id',
    'project-task-status',
    ['target_project_id', 'target_phase_id']
  ),
  copy_primary_assignee: z.boolean().default(false),
  copy_additional_assignees: z.boolean().default(false),
  copy_checklist: z.boolean().default(false),
  copy_ticket_links: z.boolean().default(false),
});

const duplicateTaskResultSchema = z.object({
  source_task_id: uuidSchema,
  task_id: uuidSchema,
  target_project_id: uuidSchema,
  target_phase_id: uuidSchema,
  target_project_status_mapping_id: nullableUuidSchema,
  target_status_id: nullableUuidSchema,
  copied_checklist_count: z.number().int().nonnegative(),
  copied_additional_assignee_count: z.number().int().nonnegative(),
  copied_ticket_link_count: z.number().int().nonnegative(),
  created_at: isoDateTimeSchema,
});

const deleteTaskInputSchema = z.object({
  task_id: withWorkflowPicker(uuidSchema, 'Project task id', 'project-task', ['project_id', 'phase_id']),
});

const deleteTaskResultSchema = z.object({
  task_id: uuidSchema,
  deleted: z.boolean(),
  deleted_ticket_link_count: z.number().int().nonnegative(),
  deleted_checklist_item_count: z.number().int().nonnegative(),
});

const deletePhaseInputSchema = z.object({
  phase_id: withWorkflowPicker(uuidSchema, 'Project phase id', 'project-phase', ['project_id']),
});

const deletePhaseResultSchema = z.object({
  phase_id: uuidSchema,
  project_id: uuidSchema,
  deleted: z.boolean(),
});

const deleteProjectInputSchema = z.object({
  project_id: withWorkflowPicker(uuidSchema, 'Project id', 'project'),
});

const deleteProjectResultSchema = z.object({
  success: z.boolean(),
  deleted: z.boolean().optional(),
  can_delete: z.boolean(),
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  dependencies: z.array(z.any()).default([]),
  alternatives: z.array(z.any()).default([]),
});

const linkTicketToTaskInputSchema = z.object({
  task_id: withWorkflowPicker(uuidSchema, 'Project task id', 'project-task', ['project_id', 'phase_id']),
  ticket_id: withWorkflowPicker(uuidSchema, 'Ticket id', 'ticket'),
  project_id: withWorkflowPicker(uuidSchema.optional(), 'Optional project id for validation', 'project'),
  phase_id: withWorkflowPicker(uuidSchema.optional(), 'Optional phase id for validation', 'project-phase', ['project_id']),
  idempotency_key: z.string().optional().describe('Optional external idempotency key'),
});

const linkTicketToTaskResultSchema = z.object({
  task_id: uuidSchema,
  ticket_id: uuidSchema,
  project_ticket_link_id: nullableUuidSchema,
  ticket_entity_link_id: nullableUuidSchema,
  project_ticket_link_created: z.boolean(),
  ticket_entity_link_created: z.boolean(),
});

const addTagInputSchema = z.object({
  project_id: withWorkflowPicker(uuidSchema, 'Project id', 'project'),
  tags: z.array(z.string().min(1)).min(1).describe('One or more tags to attach to the project'),
  idempotency_key: z.string().optional().describe('Optional external idempotency key'),
});

const addTaskTagInputSchema = z.object({
  task_id: withWorkflowPicker(uuidSchema, 'Project task id', 'project-task', ['project_id', 'phase_id']),
  tags: z.array(z.string().min(1)).min(1).describe('One or more tags to attach to the project task'),
  idempotency_key: z.string().optional().describe('Optional external idempotency key'),
});

const tagMutationResultSchema = z.object({
  added: z.array(tagResultSchema),
  existing: z.array(tagResultSchema),
  added_count: z.number().int(),
  existing_count: z.number().int(),
});

function asIsoString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function parseNullableUuid(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

function toProjectSummary(row: Record<string, unknown>) {
  return projectSummarySchema.parse({
    project_id: row.project_id,
    project_name: String(row.project_name ?? ''),
    description: row.description == null ? null : String(row.description),
    client_id: parseNullableUuid(row.client_id ?? row.company_id),
    status: row.status == null ? null : String(row.status),
    assigned_to: parseNullableUuid(row.assigned_to),
    wbs_code: row.wbs_code == null ? null : String(row.wbs_code),
    updated_at: asIsoString(row.updated_at),
  });
}

function toPhaseSummary(row: Record<string, unknown>) {
  return phaseSummarySchema.parse({
    phase_id: row.phase_id,
    project_id: row.project_id,
    phase_name: String(row.phase_name ?? ''),
    description: row.description == null ? null : String(row.description),
    status: row.status == null ? null : String(row.status),
    order_number: row.order_number == null ? null : Number(row.order_number),
    order_key: row.order_key == null ? null : String(row.order_key),
    wbs_code: row.wbs_code == null ? null : String(row.wbs_code),
    updated_at: asIsoString(row.updated_at),
  });
}

function toTaskSummary(row: Record<string, unknown>) {
  return taskSummarySchema.parse({
    task_id: row.task_id,
    project_id: row.project_id,
    phase_id: row.phase_id,
    task_name: String(row.task_name ?? ''),
    description: row.description == null ? null : String(row.description),
    assigned_to: parseNullableUuid(row.assigned_to),
    status_id: parseNullableUuid(row.status_id),
    project_status_mapping_id: parseNullableUuid(row.project_status_mapping_id),
    wbs_code: row.wbs_code == null ? null : String(row.wbs_code),
    order_key: row.order_key == null ? null : String(row.order_key),
    updated_at: asIsoString(row.updated_at),
  });
}

function handleActionError(ctx: any, error: unknown): never {
  if (
    error &&
    typeof error === 'object' &&
    'category' in error &&
    'code' in error &&
    'message' in error
  ) {
    throw error;
  }
  rethrowAsStandardError(ctx, error);
}

async function getTableColumns(tx: TenantTxContext, tableName: string): Promise<Set<string>> {
  const rows = await tx.trx('information_schema.columns')
    .select('column_name')
    .where({ table_schema: 'public', table_name: tableName });
  return new Set(rows.map((row: { column_name: string }) => row.column_name));
}

async function ensureProjectExists(ctx: any, tx: TenantTxContext, projectId: string): Promise<Record<string, unknown>> {
  const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: projectId }).first();
  if (!project) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Project not found',
      details: { project_id: projectId },
    });
  }
  return project;
}

async function ensurePhaseExists(ctx: any, tx: TenantTxContext, phaseId: string): Promise<Record<string, unknown>> {
  const phase = await tx.trx('project_phases').where({ tenant: tx.tenantId, phase_id: phaseId }).first();
  if (!phase) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Project phase not found',
      details: { phase_id: phaseId },
    });
  }
  return phase;
}

async function ensureTaskContext(ctx: any, tx: TenantTxContext, taskId: string): Promise<Record<string, unknown>> {
  const task = await tx.trx('project_tasks as pt')
    .join('project_phases as pp', function joinPhases(this: Knex.JoinClause) {
      this.on('pp.tenant', 'pt.tenant').andOn('pp.phase_id', 'pt.phase_id');
    })
    .join('projects as p', function joinProjects(this: Knex.JoinClause) {
      this.on('p.tenant', 'pp.tenant').andOn('p.project_id', 'pp.project_id');
    })
    .where({ 'pt.tenant': tx.tenantId, 'pt.task_id': taskId })
    .select('pt.*', 'pp.project_id')
    .first();

  if (!task) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Project task not found',
      details: { task_id: taskId },
    });
  }

  return task;
}

async function ensureTicketExists(ctx: any, tx: TenantTxContext, ticketId: string): Promise<Record<string, unknown>> {
  const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: ticketId }).first();
  if (!ticket) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Ticket not found',
      details: { ticket_id: ticketId },
    });
  }
  return ticket;
}

async function ensureStatusMappingExists(
  ctx: any,
  tx: TenantTxContext,
  projectStatusMappingId: string
): Promise<Record<string, unknown>> {
  const row = await tx.trx('project_status_mappings')
    .where({ tenant: tx.tenantId, project_status_mapping_id: projectStatusMappingId })
    .first();

  if (!row) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'Project status mapping not found',
      details: { project_status_mapping_id: projectStatusMappingId },
    });
  }

  return statusMappingSummarySchema.parse({
    project_status_mapping_id: row.project_status_mapping_id,
    project_id: row.project_id,
    phase_id: row.phase_id ?? null,
    status_id: row.status_id ?? null,
    standard_status_id: row.standard_status_id ?? null,
    custom_name: row.custom_name ?? null,
    display_order: row.display_order == null ? null : Number(row.display_order),
    is_visible: row.is_visible == null ? null : Boolean(row.is_visible),
    is_standard: row.is_standard == null ? null : Boolean(row.is_standard),
  });
}

async function requireProjectReadPermission(ctx: any, tx: TenantTxContext): Promise<void> {
  await requirePermission(ctx, tx, { resource: 'project', action: 'read' });
}

async function requireProjectUpdatePermission(ctx: any, tx: TenantTxContext): Promise<void> {
  await requirePermission(ctx, tx, { resource: 'project', action: 'update' });
}

async function requireProjectDeletePermission(ctx: any, tx: TenantTxContext): Promise<void> {
  await requirePermission(ctx, tx, { resource: 'project', action: 'delete' });
}

async function resolveTargetProjectStatusMappingId(
  tx: TenantTxContext,
  params: {
    sourceTask: Record<string, unknown>;
    targetProjectId: string;
    targetPhaseId: string;
    explicitTargetProjectStatusMappingId?: string;
  }
): Promise<string | null> {
  const taskColumns = await getTableColumns(tx, 'project_tasks');
  if (!taskColumns.has('project_status_mapping_id')) return null;

  if (params.explicitTargetProjectStatusMappingId) {
    const explicit = await tx.trx('project_status_mappings')
      .where({ tenant: tx.tenantId, project_status_mapping_id: params.explicitTargetProjectStatusMappingId, project_id: params.targetProjectId })
      .first();
    return explicit?.project_status_mapping_id ?? null;
  }

  const sourceMappingId = parseNullableUuid(params.sourceTask.project_status_mapping_id);
  const sourceStatusId = parseNullableUuid(params.sourceTask.status_id);

  if (sourceMappingId && String(params.sourceTask.project_id) === params.targetProjectId) {
    const same = await tx.trx('project_status_mappings')
      .where({ tenant: tx.tenantId, project_status_mapping_id: sourceMappingId, project_id: params.targetProjectId })
      .first();
    if (same?.project_status_mapping_id) return same.project_status_mapping_id;
  }

  if (sourceStatusId) {
    const sameStatus = await tx.trx('project_status_mappings')
      .where({ tenant: tx.tenantId, project_id: params.targetProjectId, status_id: sourceStatusId })
      .orderBy('display_order', 'asc')
      .first();
    if (sameStatus?.project_status_mapping_id) return sameStatus.project_status_mapping_id;
  }

  const firstVisible = await tx.trx('project_status_mappings')
    .where({ tenant: tx.tenantId, project_id: params.targetProjectId })
    .where(function visibleFilter() {
      this.where('is_visible', true).orWhereNull('is_visible');
    })
    .orderBy('display_order', 'asc')
    .first();

  return firstVisible?.project_status_mapping_id ?? null;
}

async function resolveTargetStatusId(
  tx: TenantTxContext,
  params: {
    sourceTask: Record<string, unknown>;
    targetProjectStatusMappingId: string | null;
  }
): Promise<string | null> {
  const taskColumns = await getTableColumns(tx, 'project_tasks');
  if (!taskColumns.has('status_id')) return null;

  if (params.targetProjectStatusMappingId) {
    const mapping = await tx.trx('project_status_mappings')
      .where({ tenant: tx.tenantId, project_status_mapping_id: params.targetProjectStatusMappingId })
      .first();
    return parseNullableUuid(mapping?.status_id) ?? parseNullableUuid(params.sourceTask.status_id);
  }

  return parseNullableUuid(params.sourceTask.status_id);
}

async function generateTaskWbsCode(
  tx: TenantTxContext,
  targetPhase: Record<string, unknown>
): Promise<string> {
  const baseWbs = String(targetPhase.wbs_code ?? '1');
  const countRow = await tx.trx('project_tasks')
    .where({ tenant: tx.tenantId, phase_id: targetPhase.phase_id })
    .count('* as count')
    .first();
  const nextNumber = parseInt(String((countRow as any)?.count ?? 0), 10) + 1;
  return `${baseWbs}.${nextNumber}`;
}

const uniqueStringsSorted = (values: string[]): string[] => Array.from(new Set(values)).sort();

async function getCurrentTaskAdditionalUserIds(
  tx: TenantTxContext,
  taskId: string
): Promise<string[]> {
  const hasTaskResources = await tx.trx.schema.hasTable('task_resources');
  if (!hasTaskResources) return [];

  const rows = await tx.trx('task_resources')
    .where({ tenant: tx.tenantId, task_id: taskId })
    .whereNotNull('additional_user_id')
    .select('additional_user_id');

  return uniqueStringsSorted(
    rows
      .map((row: { additional_user_id: string | null }) => row.additional_user_id)
      .filter((value: string | null): value is string => Boolean(value))
  );
}

async function resolveActiveTaskAssignmentUsers(
  ctx: any,
  tx: TenantTxContext,
  input: { primaryUserId: string; additionalUserIds: string[] }
): Promise<{ primaryUserId: string; additionalUserIds: string[] }> {
  const userColumns = await getTableColumns(tx, 'users');
  const supportsUserType = userColumns.has('user_type');
  const supportsInactive = userColumns.has('is_inactive');

  const primaryQuery = tx.trx('users')
    .where({ tenant: tx.tenantId, user_id: input.primaryUserId });
  if (supportsUserType) primaryQuery.andWhere('user_type', 'internal');
  if (supportsInactive) primaryQuery.andWhere('is_inactive', false);
  const primaryUser = await primaryQuery.first();

  if (!primaryUser) {
    throwActionError(ctx, {
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Primary assigned user not found or inactive',
      details: { primary_user_id: input.primaryUserId },
    });
  }

  const uniqueAdditional = uniqueStringsSorted(
    input.additionalUserIds.filter((userId) => userId !== input.primaryUserId)
  );
  if (uniqueAdditional.length === 0) {
    return { primaryUserId: input.primaryUserId, additionalUserIds: [] };
  }

  const additionalQuery = tx.trx('users')
    .where({ tenant: tx.tenantId });
  if (supportsUserType) additionalQuery.andWhere('user_type', 'internal');
  if (supportsInactive) additionalQuery.andWhere('is_inactive', false);

  const validAdditionalRows = await additionalQuery
    .whereIn('user_id', uniqueAdditional)
    .select('user_id');

  const validAdditionalSet = new Set(validAdditionalRows.map((row: { user_id: string }) => row.user_id));
  const invalidAdditionalUserIds = uniqueAdditional.filter((userId) => !validAdditionalSet.has(userId));

  if (invalidAdditionalUserIds.length > 0) {
    throwActionError(ctx, {
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'One or more additional assigned users are invalid or inactive',
      details: { invalid_user_ids: invalidAdditionalUserIds },
    });
  }

  return {
    primaryUserId: input.primaryUserId,
    additionalUserIds: uniqueAdditional,
  };
}

async function reconcileTaskAdditionalUsers(
  tx: TenantTxContext,
  taskId: string,
  assignedTo: string,
  additionalUserIds: string[]
): Promise<void> {
  const hasTaskResources = await tx.trx.schema.hasTable('task_resources');
  if (!hasTaskResources) return;

  await tx.trx('task_resources')
    .where({ tenant: tx.tenantId, task_id: taskId })
    .delete();

  if (additionalUserIds.length === 0) return;

  await tx.trx('task_resources').insert(
    additionalUserIds.map((userId) => ({
      tenant: tx.tenantId,
      task_id: taskId,
      assigned_to: assignedTo,
      additional_user_id: userId,
      role: 'support',
    }))
  );
}

async function canReadTickets(ctx: any, tx: TenantTxContext): Promise<boolean> {
  try {
    await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'PERMISSION_DENIED'
    ) {
      return false;
    }
    throw error;
  }
}

async function deleteFromTableIfExists(
  tx: TenantTxContext,
  tableName: string,
  whereBuilder: (query: Knex.QueryBuilder) => Knex.QueryBuilder
): Promise<number> {
  const hasTable = await tx.trx.schema.hasTable(tableName);
  if (!hasTable) return 0;
  const query = whereBuilder(tx.trx(tableName));
  const deleted = await query.delete();
  return Number(deleted ?? 0);
}

function generateTagColors(text: string): { backgroundColor: string; textColor: string } {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  const saturation = 70;
  const lightness = 85;

  const hslToHex = (h: number, s: number, l: number): string => {
    const normalizedLightness = l / 100;
    const a = (s * Math.min(normalizedLightness, 1 - normalizedLightness)) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = normalizedLightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };

    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
  };

  return {
    backgroundColor: hslToHex(hue, saturation, lightness),
    textColor: '#2C3E50',
  };
}

function uniqueNormalizedTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function pickExistingFields(
  data: Record<string, unknown>,
  availableColumns: Set<string>,
  allowedFields: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!allowedFields.has(key)) continue;
    if (!availableColumns.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

async function ensureTagMappings(
  tx: TenantTxContext,
  params: { taggedType: 'project' | 'project_task'; taggedId: string; tags: string[] }
): Promise<{ added: Array<z.infer<typeof tagResultSchema>>; existing: Array<z.infer<typeof tagResultSchema>> }> {
  const normalizedTags = uniqueNormalizedTags(params.tags);
  if (normalizedTags.length === 0) {
    return { added: [], existing: [] };
  }

  const added: Array<z.infer<typeof tagResultSchema>> = [];
  const existing: Array<z.infer<typeof tagResultSchema>> = [];
  const tagDefinitionColumns = await getTableColumns(tx, 'tag_definitions');
  const tagMappingColumns = await getTableColumns(tx, 'tag_mappings');

  for (const tagText of normalizedTags) {
    const { backgroundColor, textColor } = generateTagColors(tagText);

    const definitionRow = pickExistingFields(
      {
        tenant: tx.tenantId,
        tag_id: uuidv4(),
        tag_text: tagText,
        tagged_type: params.taggedType,
        background_color: backgroundColor,
        text_color: textColor,
        created_at: new Date().toISOString(),
      },
      tagDefinitionColumns,
      new Set(['tenant', 'tag_id', 'tag_text', 'tagged_type', 'background_color', 'text_color', 'created_at'])
    );

    await tx.trx('tag_definitions')
      .insert(definitionRow)
      .onConflict(['tenant', 'tag_text', 'tagged_type'])
      .ignore();

    const definition = await tx.trx('tag_definitions')
      .where({ tenant: tx.tenantId, tag_text: tagText, tagged_type: params.taggedType })
      .first();
    if (!definition?.tag_id) {
      throw new Error(`Failed to resolve tag definition for "${tagText}"`);
    }

    const mappingId = uuidv4();
    const mappingRow = pickExistingFields(
      {
        tenant: tx.tenantId,
        mapping_id: mappingId,
        tag_id: definition.tag_id,
        tagged_id: params.taggedId,
        tagged_type: params.taggedType,
        created_by: tx.actorUserId,
        created_at: new Date().toISOString(),
      },
      tagMappingColumns,
      new Set(['tenant', 'mapping_id', 'tag_id', 'tagged_id', 'tagged_type', 'created_by', 'created_at'])
    );

    const insertedMappings = await tx.trx('tag_mappings')
      .insert(mappingRow)
      .onConflict(['tenant', 'tag_id', 'tagged_id'])
      .ignore()
      .returning('mapping_id');

    if (insertedMappings.length > 0) {
      added.push(tagResultSchema.parse({
        tag_id: definition.tag_id,
        tag_text: definition.tag_text,
        mapping_id: typeof mappingRow.mapping_id === 'string' ? mappingRow.mapping_id : undefined,
      }));
      continue;
    }

    const mapping = await tx.trx('tag_mappings')
      .where({
        tenant: tx.tenantId,
        tag_id: definition.tag_id,
        tagged_id: params.taggedId,
        tagged_type: params.taggedType,
      })
      .first();

    existing.push(tagResultSchema.parse({
      tag_id: definition.tag_id,
      tag_text: definition.tag_text,
      mapping_id: typeof mapping?.mapping_id === 'string' ? mapping.mapping_id : undefined,
    }));
  }

  return { added, existing };
}

async function canReadProject(tx: TenantTxContext, project: Record<string, unknown>): Promise<boolean> {
  const projectId = String(project.project_id ?? '');
  if (!projectId) return false;
  const userColumns = await getTableColumns(tx, 'users');
  const hasClientId = userColumns.has('client_id');
  const actor = await tx.trx('users')
    .where({ tenant: tx.tenantId, user_id: tx.actorUserId })
    .select(hasClientId ? ['user_type', 'client_id'] : ['user_type'])
    .first<{ user_type?: string | null; client_id?: string | null }>();
  if (!actor) return false;
  if (!hasClientId) return true;
  if (actor.user_type !== 'client') return true;
  if (!actor.client_id) return false;
  const projectClientId = parseNullableUuid(project.client_id ?? project.company_id);
  return Boolean(projectClientId && projectClientId === actor.client_id);
}

async function assertProjectReadable(
  ctx: any,
  tx: TenantTxContext,
  project: Record<string, unknown>
): Promise<void> {
  const allowed = await canReadProject(tx, project);
  if (!allowed) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: project:read',
      details: { project_id: project.project_id },
    });
  }
}

async function filterAuthorizedProjects(tx: TenantTxContext, projects: Record<string, unknown>[]) {
  if (projects.length === 0) return [];
  const allowed = await Promise.all(projects.map((project) => canReadProject(tx, project)));
  return projects.filter((_, idx) => allowed[idx]);
}

export function registerProjectActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A16 — projects.create_task
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'projects.create_task',
    version: 1,
    inputSchema: z.object({
      project_id: withWorkflowPicker(uuidSchema, 'Project id', 'project'),
      phase_id: withWorkflowPicker(uuidSchema.optional(), 'Optional phase id (defaults to first phase)', 'project-phase', ['project_id']),
      title: z.string().min(1).describe('Task title'),
      description: z.string().optional().describe('Task description'),
      due_date: isoDateTimeSchema.optional().describe('Optional due date'),
      status_id: statusMappingOrStatusPicker.optional(),
      priority_id: uuidSchema.nullable().optional().describe('Optional priority id'),
      assignee: z.object({
        type: z.enum(['user', 'team']).describe('Assignee type'),
        id: uuidSchema.describe('User id or team id')
      }).optional().describe('Optional assignee'),
      link_ticket_id: withWorkflowPicker(uuidSchema.optional(), 'Optional ticket id to link', 'project-task')
    }),
    outputSchema: z.object({
      task_id: uuidSchema,
      url: z.string(),
      status_id: uuidSchema.nullable(),
      priority_id: uuidSchema.nullable(),
      created_at: isoDateTimeSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Project Task', category: 'Business Operations', description: 'Create a task under a project' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'project_task', action: 'create' });

      const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.project_id }).first();
      if (!project) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });

      const phaseId = input.phase_id ?? (await tx.trx('project_phases')
        .where({ tenant: tx.tenantId, project_id: input.project_id })
        .orderBy('order_number', 'asc')
        .first())?.phase_id;
      if (!phaseId) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project phase not found' });

      const assignedTo = input.assignee
        ? (input.assignee.type === 'user'
            ? input.assignee.id
            : (await tx.trx('teams').where({ tenant: tx.tenantId, team_id: input.assignee.id }).first())?.manager_id)
        : null;
      if (input.assignee && input.assignee.type === 'team' && !assignedTo) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Team not found' });
      }
      if (assignedTo) {
        const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: assignedTo }).first();
        if (!user) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Assignee user not found' });
      }

      let statusId: string | null = input.status_id ?? null;
      if (statusId) {
        const hasStatusMappingColumn = (await getTableColumns(tx, 'project_tasks')).has('project_status_mapping_id');
        const status = hasStatusMappingColumn
          ? await tx.trx('project_status_mappings').where({ tenant: tx.tenantId, project_status_mapping_id: statusId }).first()
          : await tx.trx('statuses').where({ tenant: tx.tenantId, status_id: statusId, status_type: 'project_task' }).first();

        if (!status) throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Invalid project task status_id' });
      } else {
        const defaultStatus = await tx.trx('statuses')
          .where({ tenant: tx.tenantId, status_type: 'project_task' })
          .orderBy('is_default', 'desc')
          .orderBy('order_number', 'asc')
          .first();
        statusId = (defaultStatus?.status_id as string | undefined) ?? null;
      }

      const phase = await tx.trx('project_phases').where({ tenant: tx.tenantId, phase_id: phaseId }).first();
      const baseWbs = (phase?.wbs_code as string) ?? '1';
      const countRow = await tx.trx('project_tasks')
        .where({ tenant: tx.tenantId, phase_id: phaseId })
        .count('* as count')
        .first();
      const n = parseInt(String((countRow as any)?.count ?? 0), 10) + 1;
      const wbsCode = `${baseWbs}.${n}`;

      const taskId = uuidv4();
      const nowIso = new Date().toISOString();
      const taskColumns = await getTableColumns(tx, 'project_tasks');
      const taskPayload: Record<string, unknown> = {
        tenant: tx.tenantId,
        task_id: taskId,
        phase_id: phaseId,
        task_name: input.title,
        description: input.description ?? null,
        assigned_to: assignedTo,
        due_date: input.due_date ?? null,
        wbs_code: wbsCode,
        created_at: nowIso,
        updated_at: nowIso,
      };
      if (taskColumns.has('description_rich_text')) taskPayload.description_rich_text = null;
      if (taskColumns.has('status_id')) taskPayload.status_id = statusId;
      if (taskColumns.has('project_status_mapping_id')) taskPayload.project_status_mapping_id = statusId;
      if (taskColumns.has('priority_id')) taskPayload.priority_id = input.priority_id ?? null;

      await tx.trx('project_tasks').insert(taskPayload);

      if (input.link_ticket_id) {
        await tx.trx('project_ticket_links').insert({
          tenant: tx.tenantId,
          link_id: uuidv4(),
          project_id: input.project_id,
          phase_id: phaseId,
          task_id: taskId,
          ticket_id: input.link_ticket_id,
          created_at: nowIso
        }).catch(() => undefined);

        await tx.trx('ticket_entity_links').insert({
          tenant: tx.tenantId,
          link_id: uuidv4(),
          ticket_id: input.link_ticket_id,
          entity_type: 'project_task',
          entity_id: taskId,
          link_type: 'project_task',
          metadata: { project_id: input.project_id, phase_id: phaseId },
          created_at: nowIso
        }).catch(() => undefined);
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:projects.create_task',
        changedData: { project_id: input.project_id, task_id: taskId, phase_id: phaseId, link_ticket_id: input.link_ticket_id ?? null },
        details: { action_id: 'projects.create_task', action_version: 1, task_id: taskId }
      });

      return {
        task_id: taskId,
        url: `/msp/projects/${input.project_id}?task=${taskId}`,
        status_id: statusId,
        priority_id: input.priority_id ?? null,
        created_at: nowIso
      };
    })
  });

  registry.register({
    id: 'projects.find',
    version: 1,
    inputSchema: z.object({
      project_id: withWorkflowPicker(uuidSchema.optional(), 'Project id', 'project'),
      name: z.string().optional().describe('Exact project name (case-insensitive)'),
      external_ref: z.string().optional().describe('Optional external reference when supported by project properties'),
      on_not_found: z.enum(['return_null', 'error']).default('return_null'),
    }).refine((value) => Boolean(value.project_id || value.name || value.external_ref), {
      message: 'project_id, name, or external_ref required',
    }),
    outputSchema: z.object({
      project: projectSummarySchema.nullable(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Project', category: 'Business Operations', description: 'Find a project by id, name, or external ref' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectReadPermission(ctx, tx);

        const startedAt = Date.now();
        const projectColumns = await getTableColumns(tx, 'projects');
        let project: Record<string, unknown> | undefined;
        let matchedBy: 'project_id' | 'name' | 'external_ref' | null = null;

        if (input.project_id) {
          project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.project_id }).first();
          matchedBy = 'project_id';
        } else if (input.name) {
          const exactName = String(input.name).trim();
          project = await tx.trx('projects')
            .where({ tenant: tx.tenantId })
            .andWhereRaw('lower(project_name) = ?', [exactName.toLowerCase()])
            .first();
          matchedBy = 'name';
        } else if (input.external_ref) {
          matchedBy = 'external_ref';
          if (projectColumns.has('properties')) {
            project = await tx.trx('projects')
              .where({ tenant: tx.tenantId })
              .andWhereRaw(`(properties->>'external_ref') = ?`, [input.external_ref])
              .first();
          }
        }

        if (project) {
          await assertProjectReadable(ctx, tx, project);
        }

        if (!project) {
          if (input.on_not_found === 'error') {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Project not found',
              details: { matched_by: matchedBy },
            });
          }
          return { project: null };
        }

        ctx.logger?.info('workflow_action:projects.find', {
          duration_ms: Date.now() - startedAt,
          matched_by: matchedBy,
        });

        return { project: toProjectSummary(project) };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.search',
    version: 1,
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query against project name and description'),
      filters: z.object({
        client_id: withWorkflowPicker(uuidSchema.optional(), 'Filter by client id', 'project'),
        assigned_to: withWorkflowPicker(uuidSchema.optional(), 'Filter by assigned user id', 'user'),
        include_inactive: z.boolean().optional(),
        status: z.string().optional(),
        sort_by: z.enum(['project_name', 'updated_at', 'created_at']).optional(),
        sort_order: z.enum(['asc', 'desc']).optional(),
      }).optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25),
    }),
    outputSchema: z.object({
      projects: z.array(projectSummarySchema),
      first_project: projectSummarySchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Projects', category: 'Business Operations', description: 'Search projects by name or description' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectReadPermission(ctx, tx);

        const startedAt = Date.now();
        const escaped = String(input.query).trim().replace(/[%_\\]/g, (match) => `\\${match}`);
        const pattern = `%${escaped}%`;
        const filters = input.filters ?? {};
        const page = input.page ?? 1;
        const pageSize = input.page_size ?? 25;

        const projectColumns = await getTableColumns(tx, 'projects');

        let base = tx.trx('projects as p').where({ 'p.tenant': tx.tenantId });
        base = base.andWhere(function searchByQuery() {
          this.whereRaw(`p.project_name ILIKE ?`, [pattern]);
          if (projectColumns.has('description')) {
            this.orWhereRaw(`p.description ILIKE ?`, [pattern]);
          }
        });

        if (filters.client_id) {
          if (projectColumns.has('client_id')) {
            base = base.andWhere('p.client_id', filters.client_id);
          } else if (projectColumns.has('company_id')) {
            base = base.andWhere('p.company_id', filters.client_id);
          }
        }

        if (filters.assigned_to && projectColumns.has('assigned_to')) {
          base = base.andWhere('p.assigned_to', filters.assigned_to);
        }

        if (!filters.include_inactive && projectColumns.has('is_inactive')) {
          base = base.andWhere(function activeProjects() {
            this.where('p.is_inactive', false).orWhereNull('p.is_inactive');
          });
        }

        if (filters.status && projectColumns.has('status')) {
          base = base.andWhere('p.status', filters.status);
        }

        const sortBy = filters.sort_by ?? 'project_name';
        const sortOrder = filters.sort_order ?? 'asc';
        const sortColumn = sortBy === 'project_name' ? 'p.project_name' : sortBy === 'created_at' ? 'p.created_at' : 'p.updated_at';

        const matchingRows = await base
          .clone()
          .clearSelect()
          .select('p.*')
          .orderBy(sortColumn, sortOrder)
          .orderBy('p.project_id', 'asc');

        const authorizedRows = await filterAuthorizedProjects(tx, matchingRows as Record<string, unknown>[]);
        const total = authorizedRows.length;
        const start = (page - 1) * pageSize;
        const pageRows = authorizedRows.slice(start, start + pageSize);
        const projects = pageRows.map((row) => toProjectSummary(row));

        ctx.logger?.info('workflow_action:projects.search', {
          duration_ms: Date.now() - startedAt,
          query_len: escaped.length,
          result_count: projects.length,
          total,
          page,
          page_size: pageSize,
        });

        return {
          projects,
          first_project: projects[0] ?? null,
          page,
          page_size: pageSize,
          total,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.find_phase',
    version: 1,
    inputSchema: z.object({
      phase_id: withWorkflowPicker(uuidSchema.optional(), 'Project phase id', 'project-phase', ['project_id']),
      project_id: withWorkflowPicker(uuidSchema.optional(), 'Project id for phase lookup', 'project'),
      name: z.string().optional().describe('Exact phase name (case-insensitive; requires project_id)'),
      on_not_found: z.enum(['return_null', 'error']).default('return_null'),
    }).superRefine((value, refinementCtx) => {
      if (!value.phase_id && !value.name) {
        refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'phase_id or name required' });
      }
      if (value.name && !value.project_id) {
        refinementCtx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['project_id'],
          message: 'project_id is required when searching by phase name',
        });
      }
    }),
    outputSchema: z.object({
      phase: phaseSummarySchema.nullable(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Project Phase', category: 'Business Operations', description: 'Find a project phase by id or exact name' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectReadPermission(ctx, tx);

        const startedAt = Date.now();
        let phase: Record<string, unknown> | undefined;
        let matchedBy: 'phase_id' | 'name' | null = null;

        if (input.phase_id) {
          phase = await tx.trx('project_phases').where({ tenant: tx.tenantId, phase_id: input.phase_id }).first();
          matchedBy = 'phase_id';
        } else if (input.name && input.project_id) {
          phase = await tx.trx('project_phases')
            .where({ tenant: tx.tenantId, project_id: input.project_id })
            .andWhereRaw('lower(phase_name) = ?', [String(input.name).trim().toLowerCase()])
            .first();
          matchedBy = 'name';
        }

        if (!phase) {
          if (input.on_not_found === 'error') {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Project phase not found',
              details: { matched_by: matchedBy },
            });
          }
          return { phase: null };
        }

        const project = await ensureProjectExists(ctx, tx, String(phase.project_id));
        await assertProjectReadable(ctx, tx, project);

        ctx.logger?.info('workflow_action:projects.find_phase', {
          duration_ms: Date.now() - startedAt,
          matched_by: matchedBy,
        });

        return { phase: toPhaseSummary(phase) };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.search_phases',
    version: 1,
    inputSchema: z.object({
      project_id: withWorkflowPicker(uuidSchema.optional(), 'Optional project id', 'project'),
      query: z.string().optional().describe('Optional phase query against name/description'),
      filters: z.object({
        status: z.string().optional(),
        sort_by: z.enum(['project_name', 'phase_name', 'updated_at', 'order']).optional(),
        sort_order: z.enum(['asc', 'desc']).optional(),
      }).optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25),
    }),
    outputSchema: z.object({
      phases: z.array(phaseSummarySchema),
      first_phase: phaseSummarySchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Project Phases', category: 'Business Operations', description: 'Search or list project phases' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectReadPermission(ctx, tx);

        const startedAt = Date.now();
        const page = input.page ?? 1;
        const pageSize = input.page_size ?? 25;
        const filters = input.filters ?? {};
        const queryText = String(input.query ?? '').trim();
        const queryPattern = `%${queryText.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;

        let base = tx.trx('project_phases as pp')
          .join('projects as p', function joinProjects(this: Knex.JoinClause) {
            this.on('p.tenant', 'pp.tenant').andOn('p.project_id', 'pp.project_id');
          })
          .where({ 'pp.tenant': tx.tenantId });

        if (input.project_id) {
          base = base.andWhere('pp.project_id', input.project_id);
        }

        if (queryText.length > 0) {
          base = base.andWhere(function queryMatch() {
            this.whereRaw(`pp.phase_name ILIKE ?`, [queryPattern]);
            this.orWhereRaw(`COALESCE(pp.description, '') ILIKE ?`, [queryPattern]);
          });
        }

        if (filters.status) {
          base = base.andWhere('pp.status', filters.status);
        }

        const sortBy = filters.sort_by ?? 'order';
        const sortOrder = filters.sort_order ?? 'asc';

        const rows = await base
          .clone()
          .clearSelect()
          .select('pp.*', ...PROJECT_TABLE_AUTH_COLUMNS.map((col) => `p.${col} as project_${col}`))
          .orderBy(sortBy === 'project_name' ? 'p.project_name' : sortBy === 'phase_name' ? 'pp.phase_name' : sortBy === 'updated_at' ? 'pp.updated_at' : 'pp.order_key', sortOrder)
          .orderBy('pp.order_number', 'asc')
          .orderBy('pp.phase_id', 'asc');

        const authorizedRows = await Promise.all(rows.map(async (row) => {
          const allowed = await canReadProject(tx, {
            project_id: row.project_project_id,
            client_id: row.project_client_id,
            assigned_to: row.project_assigned_to,
          });
          return allowed ? row : null;
        }));

        const filteredRows = authorizedRows.filter((row): row is Record<string, unknown> => Boolean(row));
        const total = filteredRows.length;
        const start = (page - 1) * pageSize;
        const pageRows = filteredRows.slice(start, start + pageSize);
        const phases = pageRows.map((row) => toPhaseSummary(row));

        ctx.logger?.info('workflow_action:projects.search_phases', {
          duration_ms: Date.now() - startedAt,
          query_len: queryText.length,
          result_count: phases.length,
          total,
          page,
          page_size: pageSize,
        });

        return {
          phases,
          first_phase: phases[0] ?? null,
          page,
          page_size: pageSize,
          total,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.find_task',
    version: 1,
    inputSchema: z.object({
      task_id: withWorkflowPicker(uuidSchema.optional(), 'Project task id', 'project-task', ['project_id', 'phase_id']),
      project_id: withWorkflowPicker(uuidSchema.optional(), 'Project id', 'project'),
      phase_id: withWorkflowPicker(uuidSchema.optional(), 'Project phase id', 'project-phase', ['project_id']),
      name: z.string().optional().describe('Exact task name (case-insensitive)'),
      on_not_found: z.enum(['return_null', 'error']).default('return_null'),
    }).superRefine((value, refinementCtx) => {
      if (!value.task_id && !value.name) {
        refinementCtx.addIssue({ code: z.ZodIssueCode.custom, message: 'task_id or name required' });
      }
      if (value.name && !value.project_id && !value.phase_id) {
        refinementCtx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['project_id'],
          message: 'project_id or phase_id is required when searching by task name',
        });
      }
    }),
    outputSchema: z.object({
      task: taskSummarySchema.nullable(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Project Task', category: 'Business Operations', description: 'Find a project task by id or exact name' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectReadPermission(ctx, tx);

        const startedAt = Date.now();
        let task: Record<string, unknown> | undefined;
        let matchedBy: 'task_id' | 'name' | null = null;

        let query = tx.trx('project_tasks as pt')
          .join('project_phases as pp', function joinPhases(this: Knex.JoinClause) {
            this.on('pp.tenant', 'pt.tenant').andOn('pp.phase_id', 'pt.phase_id');
          })
          .join('projects as p', function joinProjects(this: Knex.JoinClause) {
            this.on('p.tenant', 'pp.tenant').andOn('p.project_id', 'pp.project_id');
          })
          .where({ 'pt.tenant': tx.tenantId })
          .select('pt.*', 'pp.project_id', ...PROJECT_TABLE_AUTH_COLUMNS.map((col) => `p.${col} as project_${col}`));

        if (input.task_id) {
          task = await query.clone().andWhere('pt.task_id', input.task_id).first();
          matchedBy = 'task_id';
        } else if (input.name) {
          query = query.andWhereRaw('lower(pt.task_name) = ?', [String(input.name).trim().toLowerCase()]);
          if (input.project_id) query = query.andWhere('pp.project_id', input.project_id);
          if (input.phase_id) query = query.andWhere('pt.phase_id', input.phase_id);
          task = await query.first();
          matchedBy = 'name';
        }

        if (!task) {
          if (input.on_not_found === 'error') {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'NOT_FOUND',
              message: 'Project task not found',
              details: { matched_by: matchedBy },
            });
          }
          return { task: null };
        }

        const allowed = await canReadProject(tx, {
          project_id: task.project_project_id,
          client_id: task.project_client_id,
          assigned_to: task.project_assigned_to,
        });
        if (!allowed) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'PERMISSION_DENIED',
            message: 'Permission denied: project:read',
            details: { project_id: task.project_id },
          });
        }

        ctx.logger?.info('workflow_action:projects.find_task', {
          duration_ms: Date.now() - startedAt,
          matched_by: matchedBy,
        });

        return { task: toTaskSummary(task) };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.search_tasks',
    version: 1,
    inputSchema: z.object({
      query: z.string().optional().describe('Search task name and description'),
      filters: z.object({
        project_id: withWorkflowPicker(uuidSchema.optional(), 'Filter by project id', 'project'),
        phase_id: withWorkflowPicker(uuidSchema.optional(), 'Filter by phase id', 'project-phase', ['filters.project_id']),
        project_status_mapping_id: withWorkflowPicker(uuidSchema.optional(), 'Filter by project task status mapping id', 'project-task-status', ['filters.project_id', 'filters.phase_id']),
        status_id: uuidSchema.optional().describe('Filter by underlying status id where supported'),
        assigned_to: withWorkflowPicker(uuidSchema.optional(), 'Filter by assigned user id', 'user'),
        tags: z.array(z.string().min(1)).optional(),
      }).optional(),
      page: z.number().int().positive().default(1),
      page_size: z.number().int().positive().max(100).default(25),
    }).superRefine((value, refinementCtx) => {
      const filters = value.filters ?? {};
      if (!value.query && !filters.project_id && !filters.phase_id && !filters.project_status_mapping_id && !filters.status_id && !filters.assigned_to && !(filters.tags?.length)) {
        refinementCtx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'query or at least one filter is required',
        });
      }
    }),
    outputSchema: z.object({
      tasks: z.array(taskSummarySchema),
      first_task: taskSummarySchema.nullable(),
      page: z.number().int(),
      page_size: z.number().int(),
      total: z.number().int(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Project Tasks', category: 'Business Operations', description: 'Search project tasks by text and filters' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectReadPermission(ctx, tx);

        const startedAt = Date.now();
        const queryText = String(input.query ?? '').trim();
        const queryPattern = `%${queryText.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
        const filters = input.filters ?? {};
        const page = input.page ?? 1;
        const pageSize = input.page_size ?? 25;
        const taskColumns = await getTableColumns(tx, 'project_tasks');

        let base = tx.trx('project_tasks as pt')
          .join('project_phases as pp', function joinPhases(this: Knex.JoinClause) {
            this.on('pp.tenant', 'pt.tenant').andOn('pp.phase_id', 'pt.phase_id');
          })
          .join('projects as p', function joinProjects(this: Knex.JoinClause) {
            this.on('p.tenant', 'pp.tenant').andOn('p.project_id', 'pp.project_id');
          })
          .where({ 'pt.tenant': tx.tenantId });

        if (filters.project_id) base = base.andWhere('pp.project_id', filters.project_id);
        if (filters.phase_id) base = base.andWhere('pt.phase_id', filters.phase_id);

        if (filters.project_status_mapping_id && taskColumns.has('project_status_mapping_id')) {
          base = base.andWhere('pt.project_status_mapping_id', filters.project_status_mapping_id);
        }

        if (filters.status_id && taskColumns.has('status_id')) {
          base = base.andWhere('pt.status_id', filters.status_id);
        }

        if (filters.assigned_to) {
          base = base.andWhere('pt.assigned_to', filters.assigned_to);
        }

        if (queryText.length > 0) {
          base = base.andWhere(function queryMatch() {
            this.whereRaw(`pt.task_name ILIKE ?`, [queryPattern]);
            this.orWhereRaw(`COALESCE(pt.description, '') ILIKE ?`, [queryPattern]);
          });
        }

        if (Array.isArray(filters.tags) && filters.tags.length > 0) {
          base = base
            .join('tag_mappings as tm', function joinMappings(this: Knex.JoinClause) {
              this.on('tm.tenant', 'pt.tenant').andOn('tm.tagged_id', 'pt.task_id');
            })
            .join('tag_definitions as td', function joinDefinitions(this: Knex.JoinClause) {
              this.on('td.tenant', 'tm.tenant').andOn('td.tag_id', 'tm.tag_id');
            })
            .where('tm.tagged_type', 'project_task')
            .whereIn('td.tag_text', filters.tags);
        }

        const rows = await base
          .clone()
          .clearSelect()
          .select('pt.*', 'pp.project_id', ...PROJECT_TABLE_AUTH_COLUMNS.map((col) => `p.${col} as project_${col}`))
          .orderBy('pt.updated_at', 'desc')
          .orderBy('pt.task_name', 'asc')
          .orderBy('pt.task_id', 'asc');

        const authorizedRows = await Promise.all(rows.map(async (row) => {
          const allowed = await canReadProject(tx, {
            project_id: row.project_project_id,
            client_id: row.project_client_id,
            assigned_to: row.project_assigned_to,
          });
          return allowed ? row : null;
        }));

        const filteredRows = authorizedRows.filter((row): row is Record<string, unknown> => Boolean(row));
        const total = filteredRows.length;
        const start = (page - 1) * pageSize;
        const pageRows = filteredRows.slice(start, start + pageSize);
        const tasks = pageRows.map((row) => toTaskSummary(row));

        ctx.logger?.info('workflow_action:projects.search_tasks', {
          duration_ms: Date.now() - startedAt,
          query_len: queryText.length,
          result_count: tasks.length,
          total,
          page,
          page_size: pageSize,
        });

        return {
          tasks,
          first_task: tasks[0] ?? null,
          page,
          page_size: pageSize,
          total,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.update',
    version: 1,
    inputSchema: z.object({
      project_id: withWorkflowPicker(uuidSchema, 'Project id', 'project'),
      patch: projectUpdatePatchSchema,
    }),
    outputSchema: z.object({
      project: projectSummarySchema,
      changed_fields: updateResultSchema.shape.changed_fields,
      no_op: updateResultSchema.shape.no_op,
      updated_at: updateResultSchema.shape.updated_at,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Update Project', category: 'Business Operations', description: 'Update project name and description' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const projectColumns = await getTableColumns(tx, 'projects');
        const project = await ensureProjectExists(ctx, tx, input.project_id);
        await assertProjectReadable(ctx, tx, project);

        const patch: Record<string, unknown> = {};
        if (input.patch.project_name !== undefined && projectColumns.has('project_name')) patch.project_name = input.patch.project_name;
        if (input.patch.description !== undefined && projectColumns.has('description')) patch.description = input.patch.description;

        const changedFields = Object.keys(patch).filter((key) => String(project[key] ?? null) !== String(patch[key] ?? null));
        const nowIso = new Date().toISOString();

        if (changedFields.length > 0) {
          await tx.trx('projects')
            .where({ tenant: tx.tenantId, project_id: input.project_id })
            .update({ ...patch, updated_at: nowIso });

          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:projects.update',
            changedData: { project_id: input.project_id, changed_fields: changedFields },
            details: { action_id: 'projects.update', action_version: 1, changed_fields: changedFields, no_op: false },
          });
        } else {
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:projects.update',
            changedData: { project_id: input.project_id, changed_fields: [] },
            details: { action_id: 'projects.update', action_version: 1, changed_fields: [], no_op: true },
          });
        }

        const updated = await ensureProjectExists(ctx, tx, input.project_id);
        return {
          project: toProjectSummary(updated),
          changed_fields: changedFields,
          no_op: changedFields.length === 0,
          updated_at: asIsoString(updated.updated_at) ?? nowIso,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.update_phase',
    version: 1,
    inputSchema: z.object({
      phase_id: withWorkflowPicker(uuidSchema, 'Project phase id', 'project-phase', ['project_id']),
      patch: phaseUpdatePatchSchema,
    }),
    outputSchema: z.object({
      phase: phaseSummarySchema,
      changed_fields: updateResultSchema.shape.changed_fields,
      no_op: updateResultSchema.shape.no_op,
      updated_at: updateResultSchema.shape.updated_at,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Update Project Phase', category: 'Business Operations', description: 'Update project phase name and description' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const phaseColumns = await getTableColumns(tx, 'project_phases');
        const phase = await ensurePhaseExists(ctx, tx, input.phase_id);
        const project = await ensureProjectExists(ctx, tx, String(phase.project_id));
        await assertProjectReadable(ctx, tx, project);

        const patch: Record<string, unknown> = {};
        if (input.patch.phase_name !== undefined && phaseColumns.has('phase_name')) patch.phase_name = input.patch.phase_name;
        if (input.patch.description !== undefined && phaseColumns.has('description')) patch.description = input.patch.description;

        const changedFields = Object.keys(patch).filter((key) => String(phase[key] ?? null) !== String(patch[key] ?? null));
        const nowIso = new Date().toISOString();

        if (changedFields.length > 0) {
          await tx.trx('project_phases')
            .where({ tenant: tx.tenantId, phase_id: input.phase_id })
            .update({ ...patch, updated_at: nowIso });

          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:projects.update_phase',
            changedData: { phase_id: input.phase_id, project_id: phase.project_id, changed_fields: changedFields },
            details: { action_id: 'projects.update_phase', action_version: 1, changed_fields: changedFields, no_op: false },
          });
        } else {
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:projects.update_phase',
            changedData: { phase_id: input.phase_id, project_id: phase.project_id, changed_fields: [] },
            details: { action_id: 'projects.update_phase', action_version: 1, changed_fields: [], no_op: true },
          });
        }

        const updated = await ensurePhaseExists(ctx, tx, input.phase_id);
        return {
          phase: toPhaseSummary(updated),
          changed_fields: changedFields,
          no_op: changedFields.length === 0,
          updated_at: asIsoString(updated.updated_at) ?? nowIso,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.update_task',
    version: 1,
    inputSchema: z.object({
      task_id: withWorkflowPicker(uuidSchema, 'Project task id', 'project-task', ['project_id', 'phase_id']),
      patch: taskUpdatePatchSchema,
    }),
    outputSchema: z.object({
      task: taskSummarySchema,
      changed_fields: updateResultSchema.shape.changed_fields,
      no_op: updateResultSchema.shape.no_op,
      updated_at: updateResultSchema.shape.updated_at,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Update Project Task', category: 'Business Operations', description: 'Update project task title and description' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const taskColumns = await getTableColumns(tx, 'project_tasks');
        const task = await ensureTaskContext(ctx, tx, input.task_id);
        const project = await ensureProjectExists(ctx, tx, String(task.project_id));
        await assertProjectReadable(ctx, tx, project);

        const patch: Record<string, unknown> = {};
        if (input.patch.task_name !== undefined && taskColumns.has('task_name')) patch.task_name = input.patch.task_name;
        if (input.patch.description !== undefined && taskColumns.has('description')) patch.description = input.patch.description;

        const changedFields = Object.keys(patch).filter((key) => String(task[key] ?? null) !== String(patch[key] ?? null));
        const nowIso = new Date().toISOString();

        if (changedFields.length > 0) {
          await tx.trx('project_tasks')
            .where({ tenant: tx.tenantId, task_id: input.task_id })
            .update({ ...patch, updated_at: nowIso });

          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:projects.update_task',
            changedData: { task_id: input.task_id, project_id: task.project_id, phase_id: task.phase_id, changed_fields: changedFields },
            details: { action_id: 'projects.update_task', action_version: 1, changed_fields: changedFields, no_op: false },
          });
        } else {
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:projects.update_task',
            changedData: { task_id: input.task_id, project_id: task.project_id, phase_id: task.phase_id, changed_fields: [] },
            details: { action_id: 'projects.update_task', action_version: 1, changed_fields: [], no_op: true },
          });
        }

        const updated = await ensureTaskContext(ctx, tx, input.task_id);
        return {
          task: toTaskSummary(updated),
          changed_fields: changedFields,
          no_op: changedFields.length === 0,
          updated_at: asIsoString(updated.updated_at) ?? nowIso,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.move_task',
    version: 1,
    inputSchema: moveTaskInputSchema,
    outputSchema: moveTaskResultSchema,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Move Project Task', category: 'Business Operations', description: 'Move a project task to another phase/project/status mapping' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const taskColumns = await getTableColumns(tx, 'project_tasks');
        const sourceTask = await ensureTaskContext(ctx, tx, input.task_id);
        const sourceProject = await ensureProjectExists(ctx, tx, String(sourceTask.project_id));
        await assertProjectReadable(ctx, tx, sourceProject);

        const targetPhase = await ensurePhaseExists(ctx, tx, input.target_phase_id);
        const targetProjectId = String(targetPhase.project_id);
        if (input.target_project_id && input.target_project_id !== targetProjectId) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'target_project_id must match target phase project_id',
            details: { target_project_id: input.target_project_id, target_phase_id: input.target_phase_id },
          });
        }

        const targetProject = await ensureProjectExists(ctx, tx, targetProjectId);
        await assertProjectReadable(ctx, tx, targetProject);

        const targetProjectStatusMappingId = await resolveTargetProjectStatusMappingId(tx, {
          sourceTask,
          targetProjectId,
          targetPhaseId: input.target_phase_id,
          explicitTargetProjectStatusMappingId: input.target_project_status_mapping_id,
        });
        if (input.target_project_status_mapping_id && !targetProjectStatusMappingId) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Invalid target_project_status_mapping_id',
            details: { target_project_status_mapping_id: input.target_project_status_mapping_id },
          });
        }

        const targetStatusId = await resolveTargetStatusId(tx, {
          sourceTask,
          targetProjectStatusMappingId,
        });

        const nextWbsCode = await generateTaskWbsCode(tx, targetPhase);
        const nowIso = new Date().toISOString();
        const orderKey = taskColumns.has('order_key')
          ? `${Date.now().toString(36)}-${uuidv4().slice(0, 8)}`
          : null;

        const updatePayload: Record<string, unknown> = {
          phase_id: input.target_phase_id,
          updated_at: nowIso,
        };
        if (taskColumns.has('wbs_code')) updatePayload.wbs_code = nextWbsCode;
        if (taskColumns.has('order_key') && orderKey) updatePayload.order_key = orderKey;
        if (taskColumns.has('project_status_mapping_id')) updatePayload.project_status_mapping_id = targetProjectStatusMappingId;
        if (taskColumns.has('status_id')) updatePayload.status_id = targetStatusId;

        await tx.trx('project_tasks')
          .where({ tenant: tx.tenantId, task_id: input.task_id })
          .update(updatePayload);

        await tx.trx('project_ticket_links')
          .where({ tenant: tx.tenantId, task_id: input.task_id })
          .update({ project_id: targetProjectId, phase_id: input.target_phase_id });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.move_task',
          changedData: {
            task_id: input.task_id,
            from_project_id: sourceTask.project_id,
            from_phase_id: sourceTask.phase_id,
            to_project_id: targetProjectId,
            to_phase_id: input.target_phase_id,
            to_project_status_mapping_id: targetProjectStatusMappingId,
          },
          details: {
            action_id: 'projects.move_task',
            action_version: 1,
            task_id: input.task_id,
          },
        });

        const updatedTask = await ensureTaskContext(ctx, tx, input.task_id);
        return moveTaskResultSchema.parse({
          task_id: input.task_id,
          previous_project_id: sourceTask.project_id,
          previous_phase_id: sourceTask.phase_id,
          previous_project_status_mapping_id: sourceTask.project_status_mapping_id ?? null,
          previous_status_id: sourceTask.status_id ?? null,
          current_project_id: updatedTask.project_id,
          current_phase_id: updatedTask.phase_id,
          current_project_status_mapping_id: updatedTask.project_status_mapping_id ?? null,
          current_status_id: updatedTask.status_id ?? null,
          wbs_code: updatedTask.wbs_code ?? null,
          order_key: updatedTask.order_key ?? null,
          updated_at: asIsoString(updatedTask.updated_at) ?? nowIso,
        });
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.assign_task',
    version: 1,
    inputSchema: assignTaskInputSchema,
    outputSchema: assignmentResultSchema,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Assign Project Task', category: 'Business Operations', description: 'Assign a project task to a primary user and additional users' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const taskColumns = await getTableColumns(tx, 'project_tasks');
        const task = await ensureTaskContext(ctx, tx, input.task_id);
        const project = await ensureProjectExists(ctx, tx, String(task.project_id));
        await assertProjectReadable(ctx, tx, project);

        const resolvedUsers = await resolveActiveTaskAssignmentUsers(ctx, tx, {
          primaryUserId: input.primary_user_id,
          additionalUserIds: input.additional_user_ids ?? [],
        });
        const currentAdditionalUserIds = await getCurrentTaskAdditionalUserIds(tx, input.task_id);
        const requestedAdditionalUserIds = uniqueStringsSorted(resolvedUsers.additionalUserIds);
        const noOp = (
          parseNullableUuid(task.assigned_to) === resolvedUsers.primaryUserId &&
          currentAdditionalUserIds.join(',') === requestedAdditionalUserIds.join(',')
        );

        if (noOp && input.no_op_if_already_assigned !== false) {
          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:projects.assign_task',
            changedData: {
              task_id: input.task_id,
              project_id: task.project_id,
              phase_id: task.phase_id,
              assigned_to: resolvedUsers.primaryUserId,
              additional_user_ids: requestedAdditionalUserIds,
            },
            details: {
              action_id: 'projects.assign_task',
              action_version: 1,
              task_id: input.task_id,
              no_op: true,
              reason: input.reason ?? null,
            },
          });

          return assignmentResultSchema.parse({
            task_id: input.task_id,
            assigned_to: resolvedUsers.primaryUserId,
            additional_user_ids: requestedAdditionalUserIds,
            no_op: true,
            updated_at: asIsoString(task.updated_at) ?? new Date().toISOString(),
          });
        }

        const nowIso = new Date().toISOString();
        const taskPatch: Record<string, unknown> = {
          assigned_to: resolvedUsers.primaryUserId,
          updated_at: nowIso,
        };
        if (taskColumns.has('assigned_team_id')) taskPatch.assigned_team_id = null;

        await tx.trx('project_tasks')
          .where({ tenant: tx.tenantId, task_id: input.task_id })
          .update(taskPatch);

        await reconcileTaskAdditionalUsers(
          tx,
          input.task_id,
          resolvedUsers.primaryUserId,
          requestedAdditionalUserIds
        );

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.assign_task',
          changedData: {
            task_id: input.task_id,
            project_id: task.project_id,
            phase_id: task.phase_id,
            assigned_to: resolvedUsers.primaryUserId,
            additional_user_ids: requestedAdditionalUserIds,
          },
          details: {
            action_id: 'projects.assign_task',
            action_version: 1,
            task_id: input.task_id,
            no_op: false,
            reason: input.reason ?? null,
          },
        });

        const updatedTask = await ensureTaskContext(ctx, tx, input.task_id);
        return assignmentResultSchema.parse({
          task_id: input.task_id,
          assigned_to: parseNullableUuid(updatedTask.assigned_to),
          additional_user_ids: requestedAdditionalUserIds,
          no_op: noOp,
          updated_at: asIsoString(updatedTask.updated_at) ?? nowIso,
        });
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.duplicate_task',
    version: 1,
    inputSchema: duplicateTaskInputSchema,
    outputSchema: duplicateTaskResultSchema,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Duplicate Project Task', category: 'Business Operations', description: 'Duplicate a task into a target project phase' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requirePermission(ctx, tx, { resource: 'project', action: 'create' });
        await requireProjectReadPermission(ctx, tx);

        const sourceTask = await ensureTaskContext(ctx, tx, input.source_task_id);
        const sourceProject = await ensureProjectExists(ctx, tx, String(sourceTask.project_id));
        await assertProjectReadable(ctx, tx, sourceProject);

        const targetPhase = await ensurePhaseExists(ctx, tx, input.target_phase_id);
        const targetProjectId = String(targetPhase.project_id);
        const targetProject = await ensureProjectExists(ctx, tx, targetProjectId);
        await assertProjectReadable(ctx, tx, targetProject);

        const explicitMapping = input.target_project_status_mapping_id
          ? await ensureStatusMappingExists(ctx, tx, input.target_project_status_mapping_id)
          : null;
        if (explicitMapping && explicitMapping.project_id !== targetProjectId) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'target_project_status_mapping_id does not belong to the target project',
            details: {
              target_project_status_mapping_id: input.target_project_status_mapping_id,
              target_project_id: targetProjectId,
            },
          });
        }

        const targetProjectStatusMappingId = await resolveTargetProjectStatusMappingId(tx, {
          sourceTask,
          targetProjectId,
          targetPhaseId: input.target_phase_id,
          explicitTargetProjectStatusMappingId: input.target_project_status_mapping_id,
        });
        const targetStatusId = await resolveTargetStatusId(tx, {
          sourceTask,
          targetProjectStatusMappingId,
        });

        const sourceTaskRow = await tx.trx('project_tasks')
          .where({ tenant: tx.tenantId, task_id: input.source_task_id })
          .first();
        if (!sourceTaskRow) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'NOT_FOUND',
            message: 'Project task not found',
            details: { task_id: input.source_task_id },
          });
        }

        const taskColumns = await getTableColumns(tx, 'project_tasks');
        const copiedTaskId = uuidv4();
        const nowIso = new Date().toISOString();
        const wbsCode = await generateTaskWbsCode(tx, targetPhase);
        const orderKey = taskColumns.has('order_key')
          ? `${Date.now().toString(36)}-${uuidv4().slice(0, 8)}`
          : null;

        const assignedTo = input.copy_primary_assignee
          ? parseNullableUuid(sourceTaskRow.assigned_to)
          : null;
        const copiedTaskRow: Record<string, unknown> = {
          ...sourceTaskRow,
          task_id: copiedTaskId,
          phase_id: input.target_phase_id,
          task_name: `${String(sourceTaskRow.task_name ?? '')} (Copy)`,
          assigned_to: assignedTo,
          updated_at: nowIso,
          created_at: nowIso,
        };
        if (taskColumns.has('assigned_team_id')) copiedTaskRow.assigned_team_id = null;
        if (taskColumns.has('actual_hours')) copiedTaskRow.actual_hours = 0;
        if (taskColumns.has('estimated_hours')) copiedTaskRow.estimated_hours = sourceTaskRow.estimated_hours ?? null;
        if (taskColumns.has('project_status_mapping_id')) copiedTaskRow.project_status_mapping_id = targetProjectStatusMappingId;
        if (taskColumns.has('status_id')) copiedTaskRow.status_id = targetStatusId;
        if (taskColumns.has('wbs_code')) copiedTaskRow.wbs_code = wbsCode;
        if (taskColumns.has('order_key') && orderKey) copiedTaskRow.order_key = orderKey;

        await tx.trx('project_tasks').insert(copiedTaskRow);

        let copiedChecklistCount = 0;
        if (input.copy_checklist) {
          const hasChecklist = await tx.trx.schema.hasTable('task_checklist_items');
          if (hasChecklist) {
            const checklistRows = await tx.trx('task_checklist_items')
              .where({ tenant: tx.tenantId, task_id: input.source_task_id })
              .select('*');
            if (checklistRows.length > 0) {
              const checklistColumns = await getTableColumns(tx, 'task_checklist_items');
              const checklistInserts = checklistRows.map((row: Record<string, unknown>) => {
                const item: Record<string, unknown> = {
                  ...row,
                  checklist_item_id: uuidv4(),
                  task_id: copiedTaskId,
                };
                if (checklistColumns.has('created_at')) item.created_at = nowIso;
                if (checklistColumns.has('updated_at')) item.updated_at = nowIso;
                return item;
              });
              await tx.trx('task_checklist_items').insert(checklistInserts);
              copiedChecklistCount = checklistInserts.length;
            }
          }
        }

        let copiedAdditionalAssigneeCount = 0;
        if (input.copy_additional_assignees) {
          const hasTaskResources = await tx.trx.schema.hasTable('task_resources');
          if (hasTaskResources) {
            const sourceResources = await tx.trx('task_resources')
              .where({ tenant: tx.tenantId, task_id: input.source_task_id })
              .whereNotNull('additional_user_id')
              .select('*');
            if (sourceResources.length > 0) {
              const resourceColumns = await getTableColumns(tx, 'task_resources');
              const inserts = sourceResources.map((row: Record<string, unknown>) => ({
                ...row,
                assignment_id: uuidv4(),
                task_id: copiedTaskId,
                assigned_to: assignedTo ?? parseNullableUuid(row.assigned_to) ?? String(row.additional_user_id),
                assigned_at: resourceColumns.has('assigned_at') ? nowIso : row.assigned_at,
              }));
              await tx.trx('task_resources').insert(inserts);
              copiedAdditionalAssigneeCount = inserts.length;
            }
          }
        }

        let copiedTicketLinkCount = 0;
        if (input.copy_ticket_links) {
          const sourceLinks = await tx.trx('project_ticket_links')
            .where({ tenant: tx.tenantId, task_id: input.source_task_id })
            .select('*');
          if (sourceLinks.length > 0) {
            const canReadTicketLinks = await canReadTickets(ctx, tx);
            const allowedTicketIds = canReadTicketLinks
              ? sourceLinks.map((link: Record<string, unknown>) => String(link.ticket_id))
              : [];

            if (allowedTicketIds.length > 0) {
              const inserts = sourceLinks
                .filter((link: Record<string, unknown>) => allowedTicketIds.includes(String(link.ticket_id)))
                .map((link: Record<string, unknown>) => ({
                  ...link,
                  link_id: uuidv4(),
                  project_id: targetProjectId,
                  phase_id: input.target_phase_id,
                  task_id: copiedTaskId,
                  created_at: nowIso,
                }));
              for (const link of inserts) {
                await tx.trx('project_ticket_links').insert(link).catch(() => undefined);
                await tx.trx('ticket_entity_links').insert({
                  tenant: tx.tenantId,
                  link_id: uuidv4(),
                  ticket_id: link.ticket_id,
                  entity_type: 'project_task',
                  entity_id: copiedTaskId,
                  link_type: 'project_task',
                  metadata: { project_id: targetProjectId, phase_id: input.target_phase_id },
                  created_at: nowIso,
                }).catch(() => undefined);
                copiedTicketLinkCount += 1;
              }
            }
          }
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.duplicate_task',
          changedData: {
            source_task_id: input.source_task_id,
            task_id: copiedTaskId,
            target_project_id: targetProjectId,
            target_phase_id: input.target_phase_id,
            copied_checklist_count: copiedChecklistCount,
            copied_additional_assignee_count: copiedAdditionalAssigneeCount,
            copied_ticket_link_count: copiedTicketLinkCount,
          },
          details: {
            action_id: 'projects.duplicate_task',
            action_version: 1,
            source_task_id: input.source_task_id,
            task_id: copiedTaskId,
          },
        });

        return duplicateTaskResultSchema.parse({
          source_task_id: input.source_task_id,
          task_id: copiedTaskId,
          target_project_id: targetProjectId,
          target_phase_id: input.target_phase_id,
          target_project_status_mapping_id: targetProjectStatusMappingId,
          target_status_id: targetStatusId,
          copied_checklist_count: copiedChecklistCount,
          copied_additional_assignee_count: copiedAdditionalAssigneeCount,
          copied_ticket_link_count: copiedTicketLinkCount,
          created_at: nowIso,
        });
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.delete_task',
    version: 1,
    inputSchema: deleteTaskInputSchema,
    outputSchema: deleteTaskResultSchema,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Delete Project Task', category: 'Business Operations', description: 'Delete a project task' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectDeletePermission(ctx, tx);
        const task = await ensureTaskContext(ctx, tx, input.task_id);
        const project = await ensureProjectExists(ctx, tx, String(task.project_id));
        await assertProjectReadable(ctx, tx, project);

        const timeEntriesExist = await tx.trx.schema.hasTable('time_entries');
        if (timeEntriesExist) {
          const timeEntryCountRow = await tx.trx('time_entries')
            .where({ tenant: tx.tenantId, work_item_id: input.task_id, work_item_type: 'project_task' })
            .count('* as count')
            .first();
          const timeEntryCount = Number((timeEntryCountRow as { count?: string | number } | undefined)?.count ?? 0);
          if (timeEntryCount > 0) {
            throwActionError(ctx, {
              category: 'ValidationError',
              code: 'VALIDATION_ERROR',
              message: `Cannot delete task: ${timeEntryCount} associated time entries exist.`,
              details: { task_id: input.task_id, time_entry_count: timeEntryCount },
            });
          }
        }

        const deletedTicketLinks = await deleteFromTableIfExists(tx, 'project_ticket_links', (query) =>
          query.where({ tenant: tx.tenantId, task_id: input.task_id })
        );
        await deleteFromTableIfExists(tx, 'ticket_entity_links', (query) =>
          query.where({ tenant: tx.tenantId, entity_type: 'project_task', entity_id: input.task_id })
        );
        const deletedChecklistItems = await deleteFromTableIfExists(tx, 'task_checklist_items', (query) =>
          query.where({ tenant: tx.tenantId, task_id: input.task_id })
        );
        await deleteFromTableIfExists(tx, 'task_resources', (query) =>
          query.where({ tenant: tx.tenantId, task_id: input.task_id })
        );
        await tx.trx('project_tasks')
          .where({ tenant: tx.tenantId, task_id: input.task_id })
          .delete();

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.delete_task',
          changedData: {
            task_id: input.task_id,
            project_id: task.project_id,
            phase_id: task.phase_id,
            deleted_ticket_link_count: deletedTicketLinks,
            deleted_checklist_item_count: deletedChecklistItems,
          },
          details: {
            action_id: 'projects.delete_task',
            action_version: 1,
            task_id: input.task_id,
          },
        });

        return deleteTaskResultSchema.parse({
          task_id: input.task_id,
          deleted: true,
          deleted_ticket_link_count: deletedTicketLinks,
          deleted_checklist_item_count: deletedChecklistItems,
        });
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.delete_phase',
    version: 1,
    inputSchema: deletePhaseInputSchema,
    outputSchema: deletePhaseResultSchema,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Delete Project Phase', category: 'Business Operations', description: 'Delete a project phase' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectDeletePermission(ctx, tx);
        const phase = await ensurePhaseExists(ctx, tx, input.phase_id);
        const project = await ensureProjectExists(ctx, tx, String(phase.project_id));
        await assertProjectReadable(ctx, tx, project);

        const deleted = await tx.trx('project_phases')
          .where({ tenant: tx.tenantId, phase_id: input.phase_id })
          .delete();

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.delete_phase',
          changedData: {
            phase_id: input.phase_id,
            project_id: phase.project_id,
          },
          details: {
            action_id: 'projects.delete_phase',
            action_version: 1,
            phase_id: input.phase_id,
          },
        });

        return deletePhaseResultSchema.parse({
          phase_id: input.phase_id,
          project_id: String(phase.project_id),
          deleted: Number(deleted ?? 0) > 0,
        });
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.delete',
    version: 1,
    inputSchema: deleteProjectInputSchema,
    outputSchema: deleteProjectResultSchema,
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Delete Project', category: 'Business Operations', description: 'Delete a project with validation and cleanup' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectDeletePermission(ctx, tx);
        const project = await ensureProjectExists(ctx, tx, input.project_id);
        await assertProjectReadable(ctx, tx, project);

        const phaseIds = await tx.trx('project_phases')
          .where({ tenant: tx.tenantId, project_id: input.project_id })
          .pluck<string[]>('phase_id');
        const taskIds = phaseIds.length > 0
          ? await tx.trx('project_tasks')
              .where({ tenant: tx.tenantId })
              .whereIn('phase_id', phaseIds)
              .pluck<string[]>('task_id')
          : [];

        const timeEntriesExist = await tx.trx.schema.hasTable('time_entries');
        if (timeEntriesExist && taskIds.length > 0) {
          const timeEntryCountRow = await tx.trx('time_entries')
            .where({ tenant: tx.tenantId, work_item_type: 'project_task' })
            .whereIn('work_item_id', taskIds)
            .count('* as count')
            .first();
          const timeEntryCount = Number((timeEntryCountRow as { count?: string | number } | undefined)?.count ?? 0);
          if (timeEntryCount > 0) {
            return deleteProjectResultSchema.parse({
              success: false,
              can_delete: false,
              deleted: false,
              code: 'VALIDATION_FAILED',
              message: `Cannot delete project: ${timeEntryCount} associated task time entries exist.`,
              dependencies: [{ type: 'time_entries', count: timeEntryCount }],
              alternatives: [],
            });
          }
        }

        await deleteFromTableIfExists(tx, 'tag_mappings', (query) =>
          query.where({ tenant: tx.tenantId, tagged_type: 'project', tagged_id: input.project_id })
        );
        if (taskIds.length > 0) {
          await deleteFromTableIfExists(tx, 'tag_mappings', (query) =>
            query.where({ tenant: tx.tenantId, tagged_type: 'project_task' }).whereIn('tagged_id', taskIds)
          );
          await deleteFromTableIfExists(tx, 'ticket_entity_links', (query) =>
            query.where({ tenant: tx.tenantId, entity_type: 'project_task' }).whereIn('entity_id', taskIds)
          );
          await deleteFromTableIfExists(tx, 'task_resources', (query) =>
            query.where({ tenant: tx.tenantId }).whereIn('task_id', taskIds)
          );
          await deleteFromTableIfExists(tx, 'task_checklist_items', (query) =>
            query.where({ tenant: tx.tenantId }).whereIn('task_id', taskIds)
          );
        }
        await deleteFromTableIfExists(tx, 'project_ticket_links', (query) =>
          query.where({ tenant: tx.tenantId, project_id: input.project_id })
        );
        await deleteFromTableIfExists(tx, 'email_reply_tokens', (query) =>
          query.where({ tenant: tx.tenantId, project_id: input.project_id })
        );

        if (taskIds.length > 0) {
          await tx.trx('project_tasks')
            .where({ tenant: tx.tenantId })
            .whereIn('task_id', taskIds)
            .delete();
        }
        if (phaseIds.length > 0) {
          await tx.trx('project_phases')
            .where({ tenant: tx.tenantId })
            .whereIn('phase_id', phaseIds)
            .delete();
        }
        const deleted = await tx.trx('projects')
          .where({ tenant: tx.tenantId, project_id: input.project_id })
          .delete();

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.delete',
          changedData: {
            project_id: input.project_id,
            deleted: Number(deleted ?? 0) > 0,
          },
          details: {
            action_id: 'projects.delete',
            action_version: 1,
            project_id: input.project_id,
          },
        });

        return deleteProjectResultSchema.parse({
          success: Number(deleted ?? 0) > 0,
          deleted: Number(deleted ?? 0) > 0,
          can_delete: true,
          code: null,
          message: null,
          dependencies: [],
          alternatives: [],
        });
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.link_ticket_to_task',
    version: 1,
    inputSchema: linkTicketToTaskInputSchema,
    outputSchema: linkTicketToTaskResultSchema,
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: { label: 'Link Ticket to Project Task', category: 'Business Operations', description: 'Link a ticket to an existing project task' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const task = await ensureTaskContext(ctx, tx, input.task_id);
        const project = await ensureProjectExists(ctx, tx, String(task.project_id));
        await assertProjectReadable(ctx, tx, project);
        await ensureTicketExists(ctx, tx, input.ticket_id);

        if (input.project_id && input.project_id !== String(task.project_id)) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'project_id does not match task project',
            details: { project_id: input.project_id, task_project_id: task.project_id },
          });
        }
        if (input.phase_id && input.phase_id !== String(task.phase_id)) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'phase_id does not match task phase',
            details: { phase_id: input.phase_id, task_phase_id: task.phase_id },
          });
        }

        const nowIso = new Date().toISOString();
        const existingProjectLink = await tx.trx('project_ticket_links')
          .where({ tenant: tx.tenantId, task_id: input.task_id, ticket_id: input.ticket_id })
          .first();

        let projectTicketLinkCreated = false;
        let projectTicketLinkId = parseNullableUuid(existingProjectLink?.link_id) ?? null;
        if (!existingProjectLink) {
          const insertedProjectLinks = await tx.trx('project_ticket_links')
            .insert({
              tenant: tx.tenantId,
              link_id: uuidv4(),
              project_id: task.project_id,
              phase_id: task.phase_id,
              task_id: input.task_id,
              ticket_id: input.ticket_id,
              created_at: nowIso,
            })
            .returning('link_id')
            .catch(() => []);

          const insertedProjectLinkId = Array.isArray(insertedProjectLinks) && insertedProjectLinks.length > 0
            ? parseNullableUuid((insertedProjectLinks[0] as Record<string, unknown>).link_id)
            : null;
          const resolvedProjectLink = insertedProjectLinkId
            ? { link_id: insertedProjectLinkId }
            : await tx.trx('project_ticket_links')
                .where({ tenant: tx.tenantId, task_id: input.task_id, ticket_id: input.ticket_id })
                .first('link_id');
          projectTicketLinkId = parseNullableUuid(resolvedProjectLink?.link_id) ?? null;
          projectTicketLinkCreated = Boolean(insertedProjectLinkId);
        }

        const existingEntityLink = await tx.trx('ticket_entity_links')
          .where({
            tenant: tx.tenantId,
            ticket_id: input.ticket_id,
            entity_type: 'project_task',
            entity_id: input.task_id,
            link_type: 'project_task',
          })
          .first();

        let ticketEntityLinkCreated = false;
        let ticketEntityLinkId = parseNullableUuid(existingEntityLink?.link_id) ?? null;
        if (!existingEntityLink) {
          const insertedEntityLinks = await tx.trx('ticket_entity_links')
            .insert({
              tenant: tx.tenantId,
              link_id: uuidv4(),
              ticket_id: input.ticket_id,
              entity_type: 'project_task',
              entity_id: input.task_id,
              link_type: 'project_task',
              metadata: { project_id: task.project_id, phase_id: task.phase_id },
              created_at: nowIso,
            })
            .returning('link_id')
            .catch(() => []);

          const insertedEntityLinkId = Array.isArray(insertedEntityLinks) && insertedEntityLinks.length > 0
            ? parseNullableUuid((insertedEntityLinks[0] as Record<string, unknown>).link_id)
            : null;
          const resolvedEntityLink = insertedEntityLinkId
            ? { link_id: insertedEntityLinkId }
            : await tx.trx('ticket_entity_links')
                .where({
                  tenant: tx.tenantId,
                  ticket_id: input.ticket_id,
                  entity_type: 'project_task',
                  entity_id: input.task_id,
                  link_type: 'project_task',
                })
                .first('link_id');
          ticketEntityLinkId = parseNullableUuid(resolvedEntityLink?.link_id) ?? null;
          ticketEntityLinkCreated = Boolean(insertedEntityLinkId);
        }

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.link_ticket_to_task',
          changedData: {
            task_id: input.task_id,
            project_id: task.project_id,
            phase_id: task.phase_id,
            ticket_id: input.ticket_id,
            project_ticket_link_created: projectTicketLinkCreated,
            ticket_entity_link_created: ticketEntityLinkCreated,
          },
          details: {
            action_id: 'projects.link_ticket_to_task',
            action_version: 1,
            task_id: input.task_id,
            ticket_id: input.ticket_id,
          },
        });

        return linkTicketToTaskResultSchema.parse({
          task_id: input.task_id,
          ticket_id: input.ticket_id,
          project_ticket_link_id: projectTicketLinkId,
          ticket_entity_link_id: ticketEntityLinkId,
          project_ticket_link_created: projectTicketLinkCreated,
          ticket_entity_link_created: ticketEntityLinkCreated,
        });
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.add_tag',
    version: 1,
    inputSchema: addTagInputSchema,
    outputSchema: z.object({
      project_id: uuidSchema,
      added: tagMutationResultSchema.shape.added,
      existing: tagMutationResultSchema.shape.existing,
      added_count: tagMutationResultSchema.shape.added_count,
      existing_count: tagMutationResultSchema.shape.existing_count,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: { label: 'Add Tag to Project', category: 'Business Operations', description: 'Attach one or more tags to a project' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const project = await ensureProjectExists(ctx, tx, input.project_id);
        await assertProjectReadable(ctx, tx, project);
        const tagResult = await ensureTagMappings(tx, {
          taggedType: 'project',
          taggedId: input.project_id,
          tags: input.tags,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.add_tag',
          changedData: {
            project_id: input.project_id,
            added_count: tagResult.added.length,
            existing_count: tagResult.existing.length,
          },
          details: { action_id: 'projects.add_tag', action_version: 1, project_id: input.project_id },
        });

        return {
          project_id: input.project_id,
          added: tagResult.added,
          existing: tagResult.existing,
          added_count: tagResult.added.length,
          existing_count: tagResult.existing.length,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'projects.add_task_tag',
    version: 1,
    inputSchema: addTaskTagInputSchema,
    outputSchema: z.object({
      task_id: uuidSchema,
      added: tagMutationResultSchema.shape.added,
      existing: tagMutationResultSchema.shape.existing,
      added_count: tagMutationResultSchema.shape.added_count,
      existing_count: tagMutationResultSchema.shape.existing_count,
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: { label: 'Add Tag to Project Task', category: 'Business Operations', description: 'Attach one or more tags to a project task' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      try {
        await requireProjectUpdatePermission(ctx, tx);
        const task = await ensureTaskContext(ctx, tx, input.task_id);
        const project = await ensureProjectExists(ctx, tx, String(task.project_id));
        await assertProjectReadable(ctx, tx, project);

        const tagResult = await ensureTagMappings(tx, {
          taggedType: 'project_task',
          taggedId: input.task_id,
          tags: input.tags,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:projects.add_task_tag',
          changedData: {
            task_id: input.task_id,
            project_id: task.project_id,
            phase_id: task.phase_id,
            added_count: tagResult.added.length,
            existing_count: tagResult.existing.length,
          },
          details: { action_id: 'projects.add_task_tag', action_version: 1, task_id: input.task_id },
        });

        return {
          task_id: input.task_id,
          added: tagResult.added,
          existing: tagResult.existing,
          added_count: tagResult.added.length,
          existing_count: tagResult.existing.length,
        };
      } catch (error) {
        handleActionError(ctx, error);
      }
    }),
  });

  void ensureTicketExists;
  void ensurePhaseExists;
  void ensureTaskContext;
  void ensureStatusMappingExists;
  void requireProjectUpdatePermission;
  void requireProjectDeletePermission;
  void tagResultSchema;
  void assignmentResultSchema;
  void linkResultSchema;
  void assignTaskInputSchema;
  void duplicateTaskInputSchema;
  void deleteTaskInputSchema;
  void deletePhaseInputSchema;
  void deleteProjectInputSchema;
  void linkTicketToTaskInputSchema;
  void addTagInputSchema;
  void addTaskTagInputSchema;
}
