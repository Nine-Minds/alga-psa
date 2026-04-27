import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  uuidSchema,
  isoDateTimeSchema,
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

const PROJECT_TABLE_AUTH_COLUMNS = ['project_id', 'client_id', 'assigned_to'] as const;

type ProjectAuthRecord = {
  project_id: string;
  client_id: string | null;
  assigned_to: string | null;
};

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

  void ensureTicketExists;
  void ensurePhaseExists;
  void ensureTaskContext;
  void ensureStatusMappingExists;
  void requireProjectUpdatePermission;
  void requireProjectDeletePermission;
  void tagResultSchema;
  void assignmentResultSchema;
  void linkResultSchema;
}
