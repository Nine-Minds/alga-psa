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

export function registerSchedulingActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A15 — scheduling.assign_user
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'scheduling.assign_user',
    version: 1,
    inputSchema: z.object({
      user_id: uuidSchema.describe('Assigned user id'),
      window: z.object({
        start: isoDateTimeSchema.describe('Start time (ISO)'),
        end: isoDateTimeSchema.describe('End time (ISO)'),
        timezone: z.string().optional().describe('IANA timezone (informational)')
      }),
      link: z.object({
        type: z.enum(['ticket', 'project_task']).describe('Work item type'),
        id: uuidSchema.describe('Work item id')
      }),
      title: z.string().optional().describe('Schedule entry title'),
      notes: z.string().optional().describe('Notes'),
      conflict_mode: z.enum(['fail', 'shift', 'override']).default('fail').describe('Conflict handling mode')
    }),
    outputSchema: z.object({
      schedule_event_id: uuidSchema,
      assigned_user_id: uuidSchema,
      start: isoDateTimeSchema,
      end: isoDateTimeSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Assign User (Schedule Entry)', category: 'Business Operations', description: 'Create a schedule entry for a user' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'create' });

      // Verify user exists
      const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: input.user_id }).first();
      if (!user) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'User not found' });
      // Technician eligibility (best-effort): require Technician role.
      const technicianRole = await tx.trx('user_roles as ur')
        .join('roles as r', function joinRoles() {
          this.on('ur.tenant', 'r.tenant').andOn('ur.role_id', 'r.role_id');
        })
        .where({ 'ur.tenant': tx.tenantId, 'ur.user_id': input.user_id })
        .whereRaw('lower(r.role_name) = ?', ['technician'])
        .first();
      if (!technicianRole) {
        throwActionError(ctx, { category: 'ActionError', code: 'PERMISSION_DENIED', message: 'User is not eligible for scheduling (requires Technician role)' });
      }

      // Verify linked entity exists
      if (input.link.type === 'ticket') {
        const t = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.link.id }).first();
        if (!t) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
      } else {
        const task = await tx.trx('project_tasks').where({ tenant: tx.tenantId, task_id: input.link.id }).first();
        if (!task) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project task not found' });
      }

      let start = new Date(input.window.start);
      let end = new Date(input.window.end);
      if (!(start.getTime() < end.getTime())) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'window.start must be before window.end' });
      }

      const findConflicts = async (s: Date, e: Date) => tx.trx('schedule_entries')
        .where({ tenant: tx.tenantId, user_id: input.user_id })
        .andWhere('scheduled_start', '<', e.toISOString())
        .andWhere('scheduled_end', '>', s.toISOString())
        .select('*');

      let conflicts = await findConflicts(start, end);
      if (conflicts.length && input.conflict_mode === 'fail') {
        throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Schedule conflict detected' });
      }

      if (conflicts.length && input.conflict_mode === 'shift') {
        // Shift to the end of the latest conflicting entry.
        const latestEnd = conflicts
          .map((c: any) => new Date(c.scheduled_end).getTime())
          .reduce((a: number, b: number) => Math.max(a, b), start.getTime());
        const durationMs = end.getTime() - start.getTime();
        start = new Date(latestEnd);
        end = new Date(latestEnd + durationMs);
        conflicts = await findConflicts(start, end);
        if (conflicts.length) {
          throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Unable to shift schedule entry to a non-conflicting window' });
        }
      }

      const entryId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('schedule_entries').insert({
        tenant: tx.tenantId,
        entry_id: entryId,
        title: input.title ?? 'Scheduled work',
        work_item_id: input.link.id,
        user_id: input.user_id,
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        status: 'scheduled',
        notes: input.notes ?? null,
        work_item_type: input.link.type,
        created_at: nowIso,
        updated_at: nowIso
      });

      if (input.conflict_mode === 'override') {
        // Record conflicts (best-effort).
        const overlapping = await findConflicts(start, end);
        for (const other of overlapping) {
          if (other.entry_id === entryId) continue;
          await tx.trx('schedule_conflicts').insert({
            tenant: tx.tenantId,
            conflict_id: uuidv4(),
            entry_id_1: entryId,
            entry_id_2: other.entry_id,
            conflict_type: 'overlap',
            resolved: false,
            created_at: nowIso,
            updated_at: nowIso
          });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:scheduling.assign_user',
        changedData: { entry_id: entryId, user_id: input.user_id, start: start.toISOString(), end: end.toISOString(), link: input.link },
        details: { action_id: 'scheduling.assign_user', action_version: 1, schedule_event_id: entryId }
      });

      return { schedule_event_id: entryId, assigned_user_id: input.user_id, start: start.toISOString(), end: end.toISOString() };
    })
  });
}

