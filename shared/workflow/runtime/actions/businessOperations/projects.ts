import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  uuidSchema,
  isoDateTimeSchema,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError
} from './shared';

export function registerProjectActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A16 — projects.create_task
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'projects.create_task',
    version: 1,
    inputSchema: z.object({
      project_id: uuidSchema.describe('Project id'),
      phase_id: uuidSchema.optional().describe('Optional phase id (defaults to first phase)'),
      title: z.string().min(1).describe('Task title'),
      description: z.string().optional().describe('Task description'),
      due_date: isoDateTimeSchema.optional().describe('Optional due date'),
      status_id: uuidSchema.optional().describe('Optional initial status id (project_task status)'),
      priority_id: uuidSchema.nullable().optional().describe('Optional priority id'),
      assignee: z.object({
        type: z.enum(['user', 'team']).describe('Assignee type'),
        id: uuidSchema.describe('User id or team id')
      }).optional().describe('Optional assignee'),
      link_ticket_id: uuidSchema.optional().describe('Optional ticket id to link')
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
        const status = await tx.trx('statuses').where({ tenant: tx.tenantId, status_id: statusId, status_type: 'project_task' }).first();
        if (!status) throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Invalid project task status_id' });
      } else {
        const defaultStatus = await tx.trx('statuses')
          .where({ tenant: tx.tenantId, status_type: 'project_task' })
          .orderBy('is_default', 'desc')
          .orderBy('order_number', 'asc')
          .first();
        statusId = (defaultStatus?.status_id as string | undefined) ?? null;
      }

      // Generate next WBS code within phase.
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
      await tx.trx('project_tasks').insert({
        tenant: tx.tenantId,
        task_id: taskId,
        phase_id: phaseId,
        task_name: input.title,
        description: input.description ?? null,
        assigned_to: assignedTo,
        due_date: input.due_date ?? null,
        status_id: statusId,
        priority_id: input.priority_id ?? null,
        wbs_code: wbsCode,
        created_at: nowIso,
        updated_at: nowIso
      });

      if (input.link_ticket_id) {
        // Best-effort link to ticket via project_ticket_links.
        await tx.trx('project_ticket_links').insert({
          tenant: tx.tenantId,
          link_id: uuidv4(),
          project_id: input.project_id,
          phase_id: phaseId,
          task_id: taskId,
          ticket_id: input.link_ticket_id,
          created_at: nowIso
        }).catch(() => undefined);

        // Also link from the ticket side using ticket_entity_links (introduced by this plan).
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
}

