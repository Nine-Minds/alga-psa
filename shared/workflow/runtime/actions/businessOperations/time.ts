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

export function registerTimeActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A17 — time.create_entry
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'time.create_entry',
    version: 1,
    inputSchema: z.object({
      user_id: uuidSchema.describe('User id'),
      start: isoDateTimeSchema.describe('Start time (ISO)'),
      duration_minutes: z.number().int().positive().describe('Duration in minutes'),
      billable: z.boolean().default(true),
      rounding_minutes: z.number().int().positive().default(6).describe('Rounding increment in minutes'),
      link: z.object({
        type: z.enum(['ticket', 'project', 'project_task']).describe('Work item type'),
        id: uuidSchema.describe('Work item id')
      }).optional(),
      billing_plan_id: uuidSchema.nullable().optional().describe('Optional billing plan/service code selection'),
      tax_rate_id: uuidSchema.nullable().optional().describe('Optional tax rate id'),
      notes: z.string().optional()
    }),
    outputSchema: z.object({
      time_entry_id: uuidSchema,
      total_minutes: z.number().int(),
      billable_minutes: z.number().int()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Time Entry', category: 'Business Operations', description: 'Create a time entry linked to work' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timeentry', action: 'create' });
      // Logging time for another user is restricted; require timeentry:update as a coarse-grained elevated permission.
      if (input.user_id !== tx.actorUserId) {
        await requirePermission(ctx, tx, { resource: 'timeentry', action: 'update' });
      }

      const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: input.user_id }).first();
      if (!user) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'User not found' });

      if (input.link) {
        if (input.link.type === 'ticket') {
          const t = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.link.id }).first();
          if (!t) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
        } else if (input.link.type === 'project') {
          const p = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.link.id }).first();
          if (!p) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });
        } else {
          const task = await tx.trx('project_tasks').where({ tenant: tx.tenantId, task_id: input.link.id }).first();
          if (!task) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project task not found' });
        }
      }

      const increment = Math.max(1, input.rounding_minutes ?? 6);
      const rounded = Math.ceil(input.duration_minutes / increment) * increment;
      if (rounded > 24 * 60) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'duration_minutes too large' });
      }

      const start = new Date(input.start);
      const end = new Date(start.getTime() + rounded * 60 * 1000);
      const workTimezone = (user.timezone as string | null) ?? 'UTC';
      const workDate = start.toISOString().slice(0, 10);
      const entryId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('time_entries').insert({
        tenant: tx.tenantId,
        entry_id: entryId,
        user_id: input.user_id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        work_date: workDate,
        work_timezone: workTimezone,
        notes: input.notes ?? null,
        work_item_id: input.link?.id ?? null,
        work_item_type: input.link?.type ?? null,
        billable_duration: input.billable ? rounded : 0,
        billing_plan_id: input.billing_plan_id ?? null,
        tax_rate_id: input.tax_rate_id ?? null,
        approval_status: 'DRAFT',
        created_at: nowIso,
        updated_at: nowIso
      });

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:time.create_entry',
        changedData: { entry_id: entryId, user_id: input.user_id, minutes: rounded, billable: input.billable },
        details: { action_id: 'time.create_entry', action_version: 1, time_entry_id: entryId }
      });

      return { time_entry_id: entryId, total_minutes: rounded, billable_minutes: input.billable ? rounded : 0 };
    })
  });
}

