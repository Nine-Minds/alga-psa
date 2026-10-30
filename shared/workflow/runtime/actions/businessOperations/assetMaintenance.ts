import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import { dateOnlySchema, withWorkflowNotFoundPolicy, withWorkflowPicker } from '@alga-psa/event-schemas';
import {
  BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider,
  createAuthorizationKernel,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import { getActionRegistryV2, type ActionContext } from '../../registries/actionRegistry';
import {
  completeMaintenanceOccurrence,
  linkMaintenanceOccurrenceTicket,
  lockMaintenanceOccurrence,
  lockMaintenanceSchedule,
  setMaintenanceSchedulePaused,
  skipMaintenanceOccurrence,
  type MaintenanceOccurrenceRow,
  type MaintenanceScheduleRow,
} from '../../../../services/assets/maintenanceLifecycle';
import { createTicketWithSideEffects } from '../../../../services/tickets/createTicketWithSideEffects';
import {
  uuidSchema, isoDateTimeSchema, withTenantTransaction, requirePermission,
  writeRunAudit, throwActionError, rethrowAsStandardError, type TenantTxContext,
} from './shared';

const occurrenceSchema = z.object({
  occurrence_id: uuidSchema,
  schedule_id: uuidSchema,
  asset_id: uuidSchema,
  due_date: isoDateTimeSchema,
  status: z.enum(['open', 'completed', 'skipped', 'cancelled']),
  ticket_id: uuidSchema.nullable(),
  history_id: uuidSchema.nullable(),
});

const scheduleSchema = z.object({
  schedule_id: uuidSchema,
  asset_id: uuidSchema,
  schedule_name: z.string(),
  maintenance_type: z.string(),
  frequency: z.string(),
  frequency_interval: z.number().int().positive(),
  next_maintenance: isoDateTimeSchema,
  last_maintenance: isoDateTimeSchema.nullable(),
  is_active: z.boolean(),
  archived_at: isoDateTimeSchema.nullable(),
});

function occurrenceOutput(row: MaintenanceOccurrenceRow) {
  return occurrenceSchema.parse({ ...row, due_date: new Date(row.due_date).toISOString(), ticket_id: row.ticket_id ?? null, history_id: row.history_id ?? null });
}

function scheduleOutput(row: MaintenanceScheduleRow) {
  return scheduleSchema.parse({
    ...row,
    next_maintenance: new Date(row.next_maintenance).toISOString(),
    last_maintenance: row.last_maintenance ? new Date(row.last_maintenance).toISOString() : null,
    archived_at: row.archived_at ? new Date(row.archived_at).toISOString() : null,
  });
}

async function runMaintenanceAction<T>(ctx: ActionContext, fn: (tx: TenantTxContext) => Promise<T>): Promise<T> {
  try {
    return await withTenantTransaction(ctx, fn);
  } catch (error) {
    if (error instanceof Error) rethrowAsStandardError(ctx, error);
    throw error;
  }
}

async function audit(ctx: ActionContext, tx: TenantTxContext, actionId: string, changedData: Record<string, unknown>) {
  await writeRunAudit(ctx, tx, {
    operation: `workflow_action:${actionId}`, changedData,
    details: { action_id: actionId, action_version: 1 },
  });
}

async function requireAssetReadable(ctx: ActionContext, tx: TenantTxContext, assetId: string): Promise<void> {
  const db = tenantDb(tx.trx, tx.tenantId);
  const actor = await db.table('users').where({ user_id: tx.actorUserId }).first<{ user_type: string }>();
  if (actor?.user_type !== 'internal') throwActionError(ctx, { category: 'ActionError', code: 'PERMISSION_DENIED', message: 'Maintenance workflows require an internal actor' });
  const asset = await db.table('assets').where({ asset_id: assetId }).first<{ client_id: string | null }>();
  if (!asset) throw new Error('Maintenance asset not found');
  const roles = await db.table('user_roles').where({ user_id: tx.actorUserId }).select<{ role_id: string }[]>('role_id');
  const teams = await db.table('team_members').where({ user_id: tx.actorUserId }).select<{ team_id: string }[]>('team_id');
  const managed = await db.table('users').where({ reports_to: tx.actorUserId }).select<{ user_id: string }[]>('user_id');
  const associations = await db.table('asset_associations').where({ asset_id: assetId })
    .select<{ entity_type: string; entity_id: string }[]>('entity_type', 'entity_id');
  const assignedUserIds = associations.filter((row) => row.entity_type === 'user').map((row) => row.entity_id);
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: (input) => resolveBundleNarrowingRulesForEvaluation(tx.trx, input),
    }),
    rbacEvaluator: async () => true,
  });
  const decision = await kernel.authorizeResource({
    subject: {
      tenant: tx.tenantId, userId: tx.actorUserId, userType: 'internal',
      roleIds: roles.map((row) => row.role_id), teamIds: teams.map((row) => row.team_id),
      managedUserIds: managed.map((row) => row.user_id), clientId: null, portfolioClientIds: [],
    },
    resource: { type: 'asset', action: 'read', id: assetId },
    record: {
      id: assetId, clientId: asset.client_id, assignedUserIds, ownerUserId: assignedUserIds[0] ?? null,
      teamIds: associations.filter((row) => row.entity_type === 'team').map((row) => row.entity_id),
    },
    knex: tx.trx,
  });
  if (!decision.allowed) throwActionError(ctx, { category: 'ActionError', code: 'PERMISSION_DENIED', message: 'Permission denied: Cannot read this maintenance asset' });
}

export function registerAssetMaintenanceActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'assets.get_maintenance',
    version: 1,
    inputSchema: z.object({
      schedule_id: uuidSchema.optional().describe('Maintenance plan UUID; returns its open occurrence, if any'),
      occurrence_id: uuidSchema.optional().describe('Maintenance occurrence UUID, for example from the maintenance-due trigger'),
      ticket_id: withWorkflowPicker(uuidSchema.optional(), 'Linked ticket id (for example TICKET_CLOSED.ticketId)', 'ticket'),
      on_not_found: withWorkflowNotFoundPolicy(z.enum(['return_empty', 'error']).default('return_empty'), 'What to do when no maintenance is linked'),
    }).refine((value) => [value.schedule_id, value.occurrence_id, value.ticket_id].filter(Boolean).length === 1, {
      message: 'Provide exactly one of schedule_id, occurrence_id, or ticket_id',
    }),
    outputSchema: z.object({ found: z.boolean(), schedule: scheduleSchema.nullable(), occurrence: occurrenceSchema.nullable() }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Get Asset Maintenance', category: 'Business Operations', description: 'Get a maintenance plan and occurrence, including lookup by linked ticket for ticket-closure workflows.' },
    handler: (input, ctx) => runMaintenanceAction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'asset', action: 'read' });
      if (input.ticket_id) await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });
      const db = tenantDb(tx.trx, tx.tenantId);
      let occurrence: MaintenanceOccurrenceRow | undefined;
      if (!input.schedule_id) {
        const rows = await db.table('asset_maintenance_occurrences')
          .where(input.ticket_id ? { ticket_id: input.ticket_id } : { occurrence_id: input.occurrence_id })
          .limit(2) as MaintenanceOccurrenceRow[];
        if (rows.length > 1) throwActionError(ctx, {
          category: 'ActionError', code: 'CONFLICT',
          message: 'Multiple maintenance occurrences are linked to this ticket; use an explicit occurrence_id',
        });
        occurrence = rows[0];
      }
      const scheduleId = input.schedule_id ?? occurrence?.schedule_id;
      const schedule = scheduleId
        ? await db.table('asset_maintenance_schedules').where({ schedule_id: scheduleId }).first<MaintenanceScheduleRow>()
        : undefined;
      if (!schedule) {
        if (input.on_not_found === 'error') throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Maintenance plan or linked occurrence not found' });
        return { found: false, schedule: null, occurrence: null };
      }
      if (input.schedule_id) occurrence = await db.table('asset_maintenance_occurrences')
        .where({ schedule_id: schedule.schedule_id, status: 'open' }).first<MaintenanceOccurrenceRow>();
      await requireAssetReadable(ctx, tx, schedule.asset_id);
      return { found: true, schedule: scheduleOutput(schedule), occurrence: occurrence ? occurrenceOutput(occurrence) : null };
    }),
  });

  registry.register({
    id: 'assets.create_maintenance_ticket',
    version: 1,
    inputSchema: z.object({
      occurrence_id: uuidSchema.describe('Open occurrence to create and link a ticket for'),
      title: z.string().trim().min(1).optional().describe('Defaults to the maintenance plan name'),
      description: z.string().default(''),
      board_id: withWorkflowPicker(uuidSchema, 'Board id', 'board'),
      status_id: withWorkflowPicker(uuidSchema, 'Open ticket status id', 'ticket-status', ['board_id']),
      priority_id: withWorkflowPicker(uuidSchema, 'Priority id', 'ticket-priority'),
      category_id: withWorkflowPicker(
        uuidSchema.optional(),
        'Optional ticket category or subcategory id (like the ticket UI category dropdown; must belong to the selected board)',
        'ticket-category-any',
        ['board_id']
      ),
    }),
    outputSchema: z.object({
      occurrence_id: uuidSchema, schedule_id: uuidSchema, asset_id: uuidSchema,
      ticket_id: uuidSchema, ticket_number: z.string(), already_linked: z.boolean(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Asset Maintenance Ticket', category: 'Business Operations', description: 'Create a ticket for an open occurrence using the same linkage as the Maintenance screen. Reuses an existing linked ticket.' },
    handler: (input, ctx) => runMaintenanceAction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'asset', action: 'read' });
      await requirePermission(ctx, tx, { resource: 'asset', action: 'update' });
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'create' });
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });
      const db = tenantDb(tx.trx, tx.tenantId);
      const occurrence = await lockMaintenanceOccurrence(tx.trx, tx.tenantId, input.occurrence_id);
      await requireAssetReadable(ctx, tx, occurrence.asset_id);
      const identity = { occurrence_id: occurrence.occurrence_id, schedule_id: occurrence.schedule_id, asset_id: occurrence.asset_id };
      if (occurrence.ticket_id) {
        const ticket = await db.table('tickets').where({ ticket_id: occurrence.ticket_id }).first<{ ticket_number: string }>();
        if (!ticket) throw new Error('Linked maintenance ticket not found');
        return { ...identity, ticket_id: occurrence.ticket_id, ticket_number: ticket.ticket_number, already_linked: true };
      }
      if (occurrence.status !== 'open') throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Maintenance occurrence is no longer open' });
      const schedule = await lockMaintenanceSchedule(tx.trx, tx.tenantId, occurrence.schedule_id);
      if (!schedule.is_active) throw new Error('Maintenance schedule is inactive');
      if (schedule.asset_id !== occurrence.asset_id) throw new Error('Maintenance occurrence does not belong to its schedule asset');
      const asset = await db.table('assets').where({ asset_id: occurrence.asset_id }).first<{ client_id: string | null }>();
      if (!asset?.client_id) throw new Error('Maintenance asset must belong to a client before creating a ticket');
      const status = await db.table('statuses').where({
        status_id: input.status_id, status_type: 'ticket', board_id: input.board_id, is_closed: false,
      }).first();
      if (!status) throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'status_id must be an open ticket status on the selected board' });
      const priority = await db.table('priorities').where({ priority_id: input.priority_id, item_type: 'ticket' }).first();
      if (!priority) throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Invalid ticket priority_id' });
      // One field takes either a primary category or one of its subcategories, like the ticket UI
      // dropdown. A subcategory stores as category_id = its parent + subcategory_id = itself.
      let categoryId: string | undefined;
      let subcategoryId: string | undefined;
      if (input.category_id) {
        const category = await db.table('categories').where({ category_id: input.category_id })
          .first<{ category_id: string; board_id: string | null; parent_category: string | null }>();
        // Board-less categories are tenant-global; otherwise the category must live on the selected board.
        if (!category || (category.board_id && category.board_id !== input.board_id)) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'category_id must exist and belong to the selected board' });
        }
        if (category.parent_category) {
          const parent = await db.table('categories').where({ category_id: category.parent_category }).first();
          if (!parent) {
            throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'category_id subcategory has no parent category' });
          }
          categoryId = category.parent_category;
          subcategoryId = category.category_id;
        } else {
          categoryId = category.category_id;
        }
      }
      const ticket = await createTicketWithSideEffects(tx.trx, tx.tenantId, {
        actor: { type: 'workflow', userId: tx.actorUserId, runId: ctx.runId, workflowId: tx.workflowId, lineage: tx.lineage },
        ticket: {
          title: input.title ?? schedule.schedule_name, description: input.description,
          client_id: asset.client_id, board_id: input.board_id, status_id: input.status_id,
          priority_id: input.priority_id, category_id: categoryId, subcategory_id: subcategoryId, source: 'workflow',
        },
        assetIds: [occurrence.asset_id],
        notificationSuppression: { suppressContactNotifications: true, suppressInternalNotifications: false },
      });
      await linkMaintenanceOccurrenceTicket(tx.trx, tx.tenantId, tx.actorUserId, occurrence.occurrence_id, ticket.ticketId);
      await audit(ctx, tx, 'assets.create_maintenance_ticket', { ...identity, ticket_id: ticket.ticketId });
      return { ...identity, ticket_id: ticket.ticketId, ticket_number: ticket.ticketNumber, already_linked: false };
    }),
  });

  registry.register({
    id: 'assets.complete_maintenance',
    version: 1,
    inputSchema: z.object({
      occurrence_id: uuidSchema,
      performed_at: z.union([dateOnlySchema('Completion calendar date (YYYY-MM-DD)'), isoDateTimeSchema]).optional().describe('Completion calendar date or ISO timestamp, for example ticket.closed_at; defaults to today'),
      notes: z.string().optional(),
      maintenance_data: z.record(z.string(), z.unknown()).optional().describe('Structured completion details from the ticket or workflow'),
    }),
    outputSchema: z.object({ occurrence_id: uuidSchema, history_id: uuidSchema, next_occurrence: occurrenceSchema.nullable(), already_completed: z.boolean() }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Complete Asset Maintenance', category: 'Business Operations', description: 'Record maintenance history, complete the occurrence, and advance the plan from the performed date.' },
    handler: (input, ctx) => runMaintenanceAction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'asset', action: 'read' });
      await requirePermission(ctx, tx, { resource: 'asset', action: 'update' });
      const occurrence = await lockMaintenanceOccurrence(tx.trx, tx.tenantId, input.occurrence_id);
      await requireAssetReadable(ctx, tx, occurrence.asset_id);
      if (occurrence.status === 'completed' && occurrence.history_id) {
        return { occurrence_id: occurrence.occurrence_id, history_id: occurrence.history_id, next_occurrence: null, already_completed: true };
      }
      if (occurrence.status !== 'open') throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Only open maintenance occurrences can be completed' });
      const next = await completeMaintenanceOccurrence(tx.trx, tx.tenantId, tx.actorUserId, {
        occurrence_id: input.occurrence_id, performed_at: input.performed_at,
        notes: input.notes, maintenance_data: input.maintenance_data,
      });
      const completed = await lockMaintenanceOccurrence(tx.trx, tx.tenantId, input.occurrence_id);
      if (!completed.history_id) throw new Error('Completed maintenance occurrence has no history_id');
      await audit(ctx, tx, 'assets.complete_maintenance', { occurrence_id: input.occurrence_id, history_id: completed.history_id, next_occurrence_id: next.occurrence_id });
      return { occurrence_id: input.occurrence_id, history_id: completed.history_id, next_occurrence: occurrenceOutput(next), already_completed: false };
    }),
  });

  registry.register({
    id: 'assets.skip_maintenance',
    version: 1,
    inputSchema: z.object({ occurrence_id: uuidSchema, reason: z.string().trim().min(1).describe('Required reason for skipping') }),
    outputSchema: z.object({ occurrence_id: uuidSchema, next_occurrence: occurrenceSchema.nullable(), already_skipped: z.boolean() }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Skip Asset Maintenance', category: 'Business Operations', description: 'Skip an open occurrence with a reason and advance the plan using its cadence.' },
    handler: (input, ctx) => runMaintenanceAction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'asset', action: 'read' });
      await requirePermission(ctx, tx, { resource: 'asset', action: 'update' });
      const occurrence = await lockMaintenanceOccurrence(tx.trx, tx.tenantId, input.occurrence_id);
      await requireAssetReadable(ctx, tx, occurrence.asset_id);
      if (occurrence.status === 'skipped') return { occurrence_id: input.occurrence_id, next_occurrence: null, already_skipped: true };
      if (occurrence.status !== 'open') throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Only open maintenance occurrences can be skipped' });
      const next = await skipMaintenanceOccurrence(tx.trx, tx.tenantId, tx.actorUserId, input.occurrence_id, input.reason);
      await audit(ctx, tx, 'assets.skip_maintenance', { occurrence_id: input.occurrence_id, reason: input.reason, next_occurrence_id: next.occurrence_id });
      return { occurrence_id: input.occurrence_id, next_occurrence: occurrenceOutput(next), already_skipped: false };
    }),
  });

  registry.register({
    id: 'assets.set_maintenance_paused',
    version: 1,
    inputSchema: z.object({ schedule_id: uuidSchema, paused: z.boolean().describe('True pauses the plan; false resumes it') }),
    outputSchema: z.object({ schedule_id: uuidSchema, paused: z.boolean() }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Pause or Resume Asset Maintenance', category: 'Business Operations', description: 'Pause a plan and cancel its open occurrence, or resume it at its stored next due date.' },
    handler: (input, ctx) => runMaintenanceAction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'asset', action: 'read' });
      await requirePermission(ctx, tx, { resource: 'asset', action: 'update' });
      const schedule = await lockMaintenanceSchedule(tx.trx, tx.tenantId, input.schedule_id);
      await requireAssetReadable(ctx, tx, schedule.asset_id);
      await setMaintenanceSchedulePaused(tx.trx, tx.tenantId, tx.actorUserId, input.schedule_id, input.paused);
      await audit(ctx, tx, 'assets.set_maintenance_paused', input);
      return { schedule_id: input.schedule_id, paused: input.paused };
    }),
  });
}
