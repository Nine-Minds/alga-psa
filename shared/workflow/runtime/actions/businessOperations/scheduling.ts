import type { Knex } from 'knex';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import ScheduleEntry from '../../../../models/scheduleEntry';
import { IEditScope } from '@alga-psa/types';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  buildAppointmentAssignedPayload,
  buildAppointmentCanceledPayload,
  buildAppointmentCompletedPayload,
  buildAppointmentRescheduledPayload,
  getTicketIdFromScheduleEntry,
  isAppointmentCanceledStatus,
  isAppointmentCompletedStatus,
  isAppointmentNoShowStatus,
  shouldEmitAppointmentEvents,
} from '../../../streams/domainEventBuilders/appointmentEventBuilders';
import {
  hasPermissionByUserId,
  isoDateTimeSchema,
  requirePermission,
  throwActionError,
  uuidSchema,
  withTenantTransaction,
  writeRunAudit,
  type TenantTxContext,
} from './shared';

const WORKFLOW_PICKER_HINTS = {
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

const scheduleEntryRefSchema = z.string().trim().min(1).describe('Schedule entry id or recurring occurrence id like <entry_id>_<timestamp>');
const recurrenceScopeSchema = z.enum(['single', 'future', 'all']);
const conflictModeSchema = z.enum(['fail', 'shift', 'override']);

const schedulingEntrySummarySchema = z.object({
  entry_id: z.string().min(1),
  original_entry_id: z.string().nullable().optional(),
  title: z.string(),
  notes: z.string().nullable().optional(),
  status: z.string(),
  scheduled_start: isoDateTimeSchema,
  scheduled_end: isoDateTimeSchema,
  work_item_id: z.string().nullable().optional(),
  work_item_type: z.string().nullable().optional(),
  is_private: z.boolean(),
  is_recurring: z.boolean(),
  assigned_user_ids: z.array(uuidSchema),
});

type SchedulingEntrySummary = {
  entry_id: string;
  original_entry_id?: string | null;
  title: string;
  notes?: string | null;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  work_item_id?: string | null;
  work_item_type?: string | null;
  is_private: boolean;
  is_recurring: boolean;
  assigned_user_ids: string[];
};

function parseSchedulingEntrySummary(value: unknown): SchedulingEntrySummary {
  return schedulingEntrySummarySchema.parse(value) as SchedulingEntrySummary;
}

type AppointmentScheduleEntry = Parameters<typeof shouldEmitAppointmentEvents>[0];

function toAppointmentScheduleEntry(entry: SchedulingEntrySummary): AppointmentScheduleEntry {
  return {
    entry_id: entry.entry_id,
    status: entry.status,
    scheduled_start: entry.scheduled_start,
    scheduled_end: entry.scheduled_end,
    work_item_id: entry.work_item_id,
    work_item_type: entry.work_item_type,
    assigned_user_ids: entry.assigned_user_ids,
  };
}

type ConflictRow = {
  entry_id: string;
  original_entry_id: string | null;
  scheduled_start: string | Date;
  scheduled_end: string | Date;
  status: string | null;
  user_id: string;
};

const APPOINTMENT_IGNORED_CONFLICT_STATUSES = [
  'cancelled',
  'canceled',
  'cancel',
  'completed',
  'complete',
  'done',
  'no_show',
  'no-show',
  'noshow',
  'no show',
] as const;

function isActionErrorLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { category?: unknown; code?: unknown; message?: unknown };
  return typeof value.category === 'string' && typeof value.code === 'string' && typeof value.message === 'string';
}

function toIsoString(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${String(value)}`);
  }
  return date.toISOString();
}

function normalizeStringArray(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function appendEntryNotes(existingNotes: unknown, noteParts: Array<string | undefined>): string | null {
  const cleaned = noteParts.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  if (!cleaned.length) return typeof existingNotes === 'string' ? existingNotes : null;

  const existing = typeof existingNotes === 'string' && existingNotes.trim().length > 0
    ? existingNotes.trim()
    : '';

  return [existing, ...cleaned].filter(Boolean).join('\n\n');
}

function isSameUserSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  for (const value of right) {
    if (!leftSet.has(value)) return false;
  }
  return true;
}

type RecurrenceScope = z.infer<typeof recurrenceScopeSchema>;

function toRecurrenceScope(value: RecurrenceScope | undefined): IEditScope {
  switch (value ?? 'single') {
    case 'future':
      return IEditScope.FUTURE;
    case 'all':
      return IEditScope.ALL;
    case 'single':
    default:
      return IEditScope.SINGLE;
  }
}

function normalizeRecurrenceScope(value: RecurrenceScope | undefined): RecurrenceScope {
  return value ?? 'single';
}

function getVirtualOccurrenceAnchors(
  entryRef: string,
  recurrenceScope: RecurrenceScope | undefined,
  before: SchedulingEntrySummary
): { scheduled_start?: Date; scheduled_end?: Date } {
  if (!entryRef.includes('_')) return {};
  if (recurrenceScope !== 'single') return {};
  return {
    scheduled_start: new Date(before.scheduled_start),
    scheduled_end: new Date(before.scheduled_end),
  };
}

async function loadEntryByReference(tx: TenantTxContext, entryRef: string): Promise<SchedulingEntrySummary | null> {
  const trimmedRef = String(entryRef).trim();
  if (!trimmedRef) return null;

  if (!trimmedRef.includes('_')) {
    const entry = await ScheduleEntry.get(tx.trx, tx.tenantId, trimmedRef);
    if (!entry) return null;

    return parseSchedulingEntrySummary({
      entry_id: entry.entry_id,
      original_entry_id: (entry.original_entry_id as string | null | undefined) ?? null,
      title: String(entry.title ?? ''),
      notes: (entry.notes as string | null | undefined) ?? null,
      status: String(entry.status ?? 'scheduled'),
      scheduled_start: toIsoString(entry.scheduled_start),
      scheduled_end: toIsoString(entry.scheduled_end),
      work_item_id: (entry.work_item_id as string | null | undefined) ?? null,
      work_item_type: (entry.work_item_type as string | null | undefined) ?? null,
      is_private: Boolean(entry.is_private),
      is_recurring: Boolean(entry.is_recurring),
      assigned_user_ids: normalizeStringArray((entry.assigned_user_ids as string[] | undefined) ?? []),
    });
  }

  const [masterId, timestamp] = trimmedRef.split('_');
  const virtualTimestamp = Number.parseInt(timestamp ?? '', 10);
  if (!masterId || Number.isNaN(virtualTimestamp)) return null;

  const rangeStart = new Date(virtualTimestamp - 48 * 60 * 60 * 1000);
  const rangeEnd = new Date(virtualTimestamp + 48 * 60 * 60 * 1000);
  const entries = await ScheduleEntry.getAll(tx.trx, tx.tenantId, rangeStart, rangeEnd);
  const found = entries.find((entry: { entry_id?: string }) => entry.entry_id === trimmedRef);
  if (!found) return null;

  return parseSchedulingEntrySummary({
    entry_id: found.entry_id,
    original_entry_id: (found.original_entry_id as string | null | undefined) ?? null,
    title: String(found.title ?? ''),
    notes: (found.notes as string | null | undefined) ?? null,
    status: String(found.status ?? 'scheduled'),
    scheduled_start: toIsoString(found.scheduled_start),
    scheduled_end: toIsoString(found.scheduled_end),
    work_item_id: (found.work_item_id as string | null | undefined) ?? null,
    work_item_type: (found.work_item_type as string | null | undefined) ?? null,
    is_private: Boolean(found.is_private),
    is_recurring: Boolean(found.is_recurring),
    assigned_user_ids: normalizeStringArray((found.assigned_user_ids as string[] | undefined) ?? []),
  });
}

async function canViewPrivateEntry(tx: TenantTxContext, entry: SchedulingEntrySummary): Promise<boolean> {
  if (entry.assigned_user_ids.includes(tx.actorUserId)) return true;
  return hasPermissionByUserId(tx.trx, tx.tenantId, tx.actorUserId, 'user_schedule', 'update');
}

function redactPrivateEntry(entry: SchedulingEntrySummary): SchedulingEntrySummary {
  return {
    ...entry,
    title: 'Busy',
    notes: '',
    work_item_id: null,
    work_item_type: 'ad_hoc',
  };
}

async function detectConflicts(
  tx: TenantTxContext,
  params: {
    assignedUserIds: string[];
    requestedStartIso: string;
    requestedEndIso: string;
    targetSeriesId: string;
  }
): Promise<ConflictRow[]> {
  if (params.assignedUserIds.length === 0) return [];

  const rows = await tx.trx('schedule_entries as se')
    .join('schedule_entry_assignees as sea', function joinAssignees(this: Knex.JoinClause) {
      this.on('se.tenant', 'sea.tenant').andOn('se.entry_id', 'sea.entry_id');
    })
    .where({ 'se.tenant': tx.tenantId })
    .whereIn('sea.user_id', params.assignedUserIds)
    .andWhere('se.scheduled_start', '<', params.requestedEndIso)
    .andWhere('se.scheduled_end', '>', params.requestedStartIso)
    .andWhereRaw('coalesce(se.original_entry_id, se.entry_id) <> ?', [params.targetSeriesId])
    .andWhere(function onlyActiveStatuses(this: Knex.QueryBuilder) {
      this.whereNull('se.status').orWhereRaw('lower(se.status) not in (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...APPOINTMENT_IGNORED_CONFLICT_STATUSES]);
    })
    .select(
      'se.entry_id',
      'se.original_entry_id',
      'se.scheduled_start',
      'se.scheduled_end',
      'se.status',
      'sea.user_id'
    );

  return rows as ConflictRow[];
}

async function ensureTechnicianEligibility(
  ctx: Parameters<typeof throwActionError>[0],
  tx: TenantTxContext,
  userIds: string[]
): Promise<void> {
  const uniqueUserIds = normalizeStringArray(userIds);
  if (!uniqueUserIds.length) {
    throwActionError(ctx, {
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'assigned_user_ids must include at least one technician user id',
    });
  }

  const users = await tx.trx('users')
    .where({ tenant: tx.tenantId, user_type: 'internal', is_inactive: false })
    .whereIn('user_id', uniqueUserIds)
    .select('user_id');

  const validUsers = new Set(users.map((row: { user_id: string }) => row.user_id));
  const missingUsers = uniqueUserIds.filter((id) => !validUsers.has(id));
  if (missingUsers.length > 0) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'NOT_FOUND',
      message: 'One or more assigned users were not found or are inactive/internal-only ineligible',
      details: { missing_user_ids: missingUsers },
    });
  }

  const technicianRows = await tx.trx('user_roles as ur')
    .join('roles as r', function joinRoles(this: Knex.JoinClause) {
      this.on('ur.tenant', 'r.tenant').andOn('ur.role_id', 'r.role_id');
    })
    .where({ 'ur.tenant': tx.tenantId })
    .whereIn('ur.user_id', uniqueUserIds)
    .whereRaw('lower(r.role_name) = ?', ['technician'])
    .select('ur.user_id');

  const technicianUsers = new Set(technicianRows.map((row: { user_id: string }) => row.user_id));
  const ineligibleUsers = uniqueUserIds.filter((id) => !technicianUsers.has(id));
  if (ineligibleUsers.length > 0) {
    throwActionError(ctx, {
      category: 'ActionError',
      code: 'PERMISSION_DENIED',
      message: 'One or more users are not eligible for scheduling (requires Technician role)',
      details: { ineligible_user_ids: ineligibleUsers },
    });
  }
}

const maybeWorkflowActor = (userId: string): { actorType: 'USER'; actorUserId: string } =>
  ({ actorType: 'USER', actorUserId: userId });

async function publishWorkflowDomainEvent(params: {
  eventType: 'APPOINTMENT_RESCHEDULED' | 'APPOINTMENT_ASSIGNED' | 'APPOINTMENT_CANCELED' | 'APPOINTMENT_COMPLETED';
  payload: Record<string, unknown>;
  tenantId: string;
  occurredAt: string;
  actorUserId: string;
  idempotencyKey: string;
}): Promise<void> {
  try {
    const publishers = (await import('@alga-psa/event-bus/publishers')) as unknown as {
      publishWorkflowEvent?: (value: {
        eventType: string;
        payload: Record<string, unknown>;
        ctx: {
          tenantId: string;
          occurredAt: string;
          actor: { actorType: 'USER'; actorUserId: string };
        };
        idempotencyKey: string;
      }) => Promise<unknown>;
    };
    if (!publishers.publishWorkflowEvent) return;

    await publishers.publishWorkflowEvent({
      eventType: params.eventType,
      payload: params.payload,
      ctx: {
        tenantId: params.tenantId,
        occurredAt: params.occurredAt,
        actor: maybeWorkflowActor(params.actorUserId),
      },
      idempotencyKey: params.idempotencyKey,
    });
  } catch {
    // Best-effort publication; action persistence/audit remains source of truth.
  }
}

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
        timezone: z.string().optional().describe('IANA timezone (informational)'),
      }),
      link: z.object({
        type: z.enum(['ticket', 'project_task']).describe('Work item type'),
        id: uuidSchema.describe('Work item id'),
      }),
      title: z.string().optional().describe('Schedule entry title'),
      notes: z.string().optional().describe('Notes'),
      conflict_mode: z.enum(['fail', 'shift', 'override']).default('fail').describe('Conflict handling mode'),
    }),
    outputSchema: z.object({
      schedule_event_id: uuidSchema,
      assigned_user_id: uuidSchema,
      start: isoDateTimeSchema,
      end: isoDateTimeSchema,
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Assign User (Schedule Entry)', category: 'Business Operations', description: 'Create a schedule entry for a user' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'create' });

      const user = await tx.trx('users').where({ tenant: tx.tenantId, user_id: input.user_id }).first();
      if (!user) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'User not found' });

      const technicianRole = await tx.trx('user_roles as ur')
        .join('roles as r', function joinRoles(this: Knex.JoinClause) {
          this.on('ur.tenant', 'r.tenant').andOn('ur.role_id', 'r.role_id');
        })
        .where({ 'ur.tenant': tx.tenantId, 'ur.user_id': input.user_id })
        .whereRaw('lower(r.role_name) = ?', ['technician'])
        .first();
      if (!technicianRole) {
        throwActionError(ctx, { category: 'ActionError', code: 'PERMISSION_DENIED', message: 'User is not eligible for scheduling (requires Technician role)' });
      }

      if (input.link.type === 'ticket') {
        const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.link.id }).first();
        if (!ticket) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
      } else {
        const task = await tx.trx('project_tasks').where({ tenant: tx.tenantId, task_id: input.link.id }).first();
        if (!task) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project task not found' });
      }

      let start = new Date(input.window.start);
      let end = new Date(input.window.end);
      if (!(start.getTime() < end.getTime())) {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'window.start must be before window.end' });
      }

      const findConflicts = async (s: Date, e: Date) => tx.trx('schedule_entries as se')
        .join('schedule_entry_assignees as sea', function joinAssignees(this: Knex.JoinClause) {
          this.on('se.tenant', 'sea.tenant').andOn('se.entry_id', 'sea.entry_id');
        })
        .where({ 'se.tenant': tx.tenantId, 'sea.user_id': input.user_id })
        .andWhere('se.scheduled_start', '<', e.toISOString())
        .andWhere('se.scheduled_end', '>', s.toISOString())
        .select('se.*');

      let conflicts = await findConflicts(start, end);
      if (conflicts.length && input.conflict_mode === 'fail') {
        throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Schedule conflict detected' });
      }

      if (conflicts.length && input.conflict_mode === 'shift') {
        const latestEnd = conflicts
          .map((c: { scheduled_end: string | Date }) => new Date(c.scheduled_end).getTime())
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
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        status: 'scheduled',
        notes: input.notes ?? null,
        work_item_type: input.link.type,
        created_at: nowIso,
        updated_at: nowIso,
      });
      await tx.trx('schedule_entry_assignees').insert({
        tenant: tx.tenantId,
        entry_id: entryId,
        user_id: input.user_id,
        created_at: nowIso,
        updated_at: nowIso,
      });

      if (input.conflict_mode === 'override') {
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
            updated_at: nowIso,
          });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:scheduling.assign_user',
        changedData: { entry_id: entryId, user_id: input.user_id, start: start.toISOString(), end: end.toISOString(), link: input.link },
        details: { action_id: 'scheduling.assign_user', action_version: 1, schedule_event_id: entryId },
      });

      return { schedule_event_id: entryId, assigned_user_id: input.user_id, start: start.toISOString(), end: end.toISOString() };
    }),
  });

  registry.register({
    id: 'scheduling.find_entry',
    version: 1,
    inputSchema: z.object({
      entry_id: scheduleEntryRefSchema,
      include_private_details: z.boolean().default(false).describe('When false, private entries are redacted unless viewer has elevated visibility'),
    }),
    outputSchema: z.object({
      found: z.boolean(),
      entry: schedulingEntrySummarySchema.nullable(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Schedule Entry', category: 'Business Operations', description: 'Find a schedule entry by id' },
    handler: async (input, ctx) => {
      try {
        return await withTenantTransaction(ctx, async (tx) => {
          await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });

          const entry = await loadEntryByReference(tx, input.entry_id);
          if (!entry) {
            return { found: false, entry: null };
          }

          if (!entry.is_private) {
            return { found: true, entry };
          }

          const canSeePrivate = await canViewPrivateEntry(tx, entry);
          if (canSeePrivate) {
            return { found: true, entry };
          }

          return { found: true, entry: redactPrivateEntry(entry) };
        });
      } catch (error) {
        if (isActionErrorLike(error)) throw error;
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  registry.register({
    id: 'scheduling.search_entries',
    version: 1,
    inputSchema: z.object({
      window: z.object({
        start: isoDateTimeSchema.optional().describe('Search window start (ISO)'),
        end: isoDateTimeSchema.optional().describe('Search window end (ISO)'),
      }).optional(),
      assigned_user_ids: z.array(withWorkflowPicker(uuidSchema, 'Assigned technician user id', 'user')).optional(),
      work_item: z.object({
        type: z.enum(['ticket', 'project_task', 'appointment_request', 'ad_hoc', 'interaction']).describe('Work item type'),
        id: uuidSchema.describe('Work item id'),
      }).optional(),
      status: z.array(z.string().min(1)).optional().describe('Status filter list'),
      query: z.string().min(1).optional().describe('Search title/notes text'),
      limit: z.number().int().min(1).max(100).default(25),
    }).refine((value) => {
      const hasWindow = Boolean(value.window?.start || value.window?.end);
      return hasWindow || Boolean(value.assigned_user_ids?.length) || Boolean(value.work_item) || Boolean(value.status?.length) || Boolean(value.query);
    }, { message: 'At least one search criterion is required' }),
    outputSchema: z.object({
      entries: z.array(schedulingEntrySummarySchema),
      count: z.number().int(),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Search Schedule Entries', category: 'Business Operations', description: 'Search schedule entries by window, assignee, work item, status, or text' },
    handler: async (input, ctx) => {
      try {
        return await withTenantTransaction(ctx, async (tx) => {
          await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'read' });

          const queryBuilder = tx.trx('schedule_entries as se')
            .where({ 'se.tenant': tx.tenantId })
            .orderBy('se.scheduled_start', 'asc')
            .limit(input.limit ?? 25)
            .select('se.*');

          if (input.window?.start) {
            queryBuilder.andWhere('se.scheduled_end', '>', input.window.start);
          }
          if (input.window?.end) {
            queryBuilder.andWhere('se.scheduled_start', '<', input.window.end);
          }
          if (input.work_item) {
            queryBuilder.andWhere({ 'se.work_item_type': input.work_item.type, 'se.work_item_id': input.work_item.id });
          }
          const statusFilters = input.status?.map((status) => status.toLowerCase()) ?? [];
          if (statusFilters.length > 0) {
            const placeholders = statusFilters.map(() => '?').join(', ');
            queryBuilder.andWhere(function matchStatus(this: Knex.QueryBuilder) {
              this.whereRaw(`lower(se.status) in (${placeholders})`, statusFilters);
            });
          }
          if (input.query) {
            const escaped = input.query.replace(/[%_\\]/g, (match) => `\\${match}`);
            const canSearchAllPrivateDetails = await hasPermissionByUserId(tx.trx, tx.tenantId, tx.actorUserId, 'user_schedule', 'update');
            queryBuilder.andWhere(function byText(this: Knex.QueryBuilder) {
              this.where(function visibleText(this: Knex.QueryBuilder) {
                this.whereRaw("se.title ILIKE ? ESCAPE E'\\\\'", [`%${escaped}%`])
                  .orWhereRaw("coalesce(se.notes, '') ILIKE ? ESCAPE E'\\\\'", [`%${escaped}%`]);
              }).andWhere(function searchableDetails(this: Knex.QueryBuilder) {
                this.whereRaw('coalesce(se.is_private, false) = false')
                  .orWhereExists(function assignedToActor(this: Knex.QueryBuilder) {
                    this.select(tx.trx.raw('1'))
                      .from('schedule_entry_assignees as search_sea')
                      .whereRaw('search_sea.tenant = se.tenant')
                      .whereRaw('search_sea.entry_id = se.entry_id')
                      .where('search_sea.user_id', tx.actorUserId);
                  });
                if (canSearchAllPrivateDetails) {
                  this.orWhereRaw('true');
                }
              });
            });
          }
          const assignedUserIdsFilter = input.assigned_user_ids ?? [];
          if (assignedUserIdsFilter.length > 0) {
            queryBuilder.whereExists(function whereAssigned(this: Knex.QueryBuilder) {
              this.select(tx.trx.raw('1'))
                .from('schedule_entry_assignees as sea')
                .whereRaw('sea.tenant = se.tenant')
                .whereRaw('sea.entry_id = se.entry_id')
                .whereIn('sea.user_id', assignedUserIdsFilter);
            });
          }

          const rows = await queryBuilder;
          const entryIds = rows.map((row: { entry_id: string }) => row.entry_id);

          const assignmentRows = entryIds.length
            ? await tx.trx('schedule_entry_assignees')
              .where({ tenant: tx.tenantId })
              .whereIn('entry_id', entryIds)
              .select('entry_id', 'user_id')
            : [];

          const assignmentMap = new Map<string, string[]>();
          for (const row of assignmentRows as Array<{ entry_id: string; user_id: string }>) {
            const current = assignmentMap.get(row.entry_id) ?? [];
            current.push(row.user_id);
            assignmentMap.set(row.entry_id, current);
          }

          const entries: SchedulingEntrySummary[] = [];
          for (const row of rows as Array<Record<string, unknown>>) {
            const parsed = parseSchedulingEntrySummary({
              entry_id: row.entry_id,
              original_entry_id: (row.original_entry_id as string | null | undefined) ?? null,
              title: String(row.title ?? ''),
              notes: (row.notes as string | null | undefined) ?? null,
              status: String(row.status ?? 'scheduled'),
              scheduled_start: toIsoString(row.scheduled_start),
              scheduled_end: toIsoString(row.scheduled_end),
              work_item_id: (row.work_item_id as string | null | undefined) ?? null,
              work_item_type: (row.work_item_type as string | null | undefined) ?? null,
              is_private: Boolean(row.is_private),
              is_recurring: Boolean(row.is_recurring),
              assigned_user_ids: normalizeStringArray(assignmentMap.get(String(row.entry_id)) ?? []),
            });

            if (!parsed.is_private) {
              entries.push(parsed);
              continue;
            }

            const canSeePrivate = await canViewPrivateEntry(tx, parsed);
            entries.push(canSeePrivate ? parsed : redactPrivateEntry(parsed));
          }

          return { entries, count: entries.length };
        });
      } catch (error) {
        if (isActionErrorLike(error)) throw error;
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  registry.register({
    id: 'scheduling.reschedule',
    version: 1,
    inputSchema: z.object({
      entry_id: scheduleEntryRefSchema,
      window: z.object({
        start: isoDateTimeSchema.describe('New schedule window start (ISO)'),
        end: isoDateTimeSchema.describe('New schedule window end (ISO)'),
      }).describe('Requested schedule window'),
      timezone: z.string().optional().describe('IANA timezone for event payload metadata'),
      conflict_mode: conflictModeSchema.default('fail').describe('Conflict handling mode'),
      recurrence_scope: recurrenceScopeSchema.default('single').describe('Recurring update scope'),
      reason: z.string().trim().min(1).optional().describe('Optional reason for reschedule'),
      note: z.string().trim().min(1).optional().describe('Optional note to append to entry notes'),
    }),
    outputSchema: z.object({
      entry_id: z.string().min(1),
      updated_entry_id: z.string().min(1),
      previous_start: isoDateTimeSchema,
      previous_end: isoDateTimeSchema,
      new_start: isoDateTimeSchema,
      new_end: isoDateTimeSchema,
      assigned_user_ids: z.array(uuidSchema),
      conflict_mode: conflictModeSchema,
      conflicts_detected: z.number().int().min(0),
      recurrence_scope: recurrenceScopeSchema,
      event_type: z.enum(['APPOINTMENT_RESCHEDULED']).nullable(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Reschedule Entry', category: 'Business Operations', description: 'Move a schedule entry to a new window' },
    handler: async (input, ctx) => {
      try {
        return await withTenantTransaction(ctx, async (tx) => {
          await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'update' });

          const before = await loadEntryByReference(tx, input.entry_id);
          if (!before) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          if (!(new Date(input.window.start).getTime() < new Date(input.window.end).getTime())) {
            throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'window.start must be before window.end' });
          }

          const recurrenceScope = normalizeRecurrenceScope(input.recurrence_scope);
          const conflictMode = input.conflict_mode ?? 'fail';
          const targetSeriesId = before.original_entry_id ?? before.entry_id.split('_')[0] ?? before.entry_id;
          const durationMs = new Date(input.window.end).getTime() - new Date(input.window.start).getTime();

          let nextStartIso = toIsoString(input.window.start);
          let nextEndIso = toIsoString(input.window.end);
          let detectedConflicts = await detectConflicts(tx, {
            assignedUserIds: before.assigned_user_ids,
            requestedStartIso: nextStartIso,
            requestedEndIso: nextEndIso,
            targetSeriesId,
          });

          if (detectedConflicts.length > 0 && conflictMode === 'fail') {
            throwActionError(ctx, {
              category: 'ActionError',
              code: 'CONFLICT',
              message: 'Schedule conflict detected for one or more assignees',
              details: {
                conflict_count: detectedConflicts.length,
                conflicts: detectedConflicts.map((row) => ({
                  entry_id: row.entry_id,
                  user_id: row.user_id,
                  start: toIsoString(row.scheduled_start),
                  end: toIsoString(row.scheduled_end),
                })),
              },
            });
          }

          if (detectedConflicts.length > 0 && conflictMode === 'shift') {
            const maxAttempts = 32;
            let attempts = 0;
            while (detectedConflicts.length > 0 && attempts < maxAttempts) {
              attempts += 1;
              const latestConflictEnd = Math.max(...detectedConflicts.map((row) => new Date(row.scheduled_end).getTime()));
              nextStartIso = new Date(latestConflictEnd).toISOString();
              nextEndIso = new Date(latestConflictEnd + durationMs).toISOString();
              detectedConflicts = await detectConflicts(tx, {
                assignedUserIds: before.assigned_user_ids,
                requestedStartIso: nextStartIso,
                requestedEndIso: nextEndIso,
                targetSeriesId,
              });
            }

            if (detectedConflicts.length > 0) {
              throwActionError(ctx, {
                category: 'ActionError',
                code: 'CONFLICT',
                message: 'Unable to shift entry to a non-conflicting window',
              });
            }
          }

          const nextNotes = appendEntryNotes(before.notes, [input.reason ? `Reschedule reason: ${input.reason}` : undefined, input.note]) ?? undefined;
          const updated = await ScheduleEntry.update(
            tx.trx,
            tx.tenantId,
            input.entry_id,
            {
              scheduled_start: new Date(nextStartIso),
              scheduled_end: new Date(nextEndIso),
              notes: nextNotes,
            },
            toRecurrenceScope(recurrenceScope)
          );

          if (!updated) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          const updatedEntry = parseSchedulingEntrySummary({
            entry_id: updated.entry_id,
            original_entry_id: (updated.original_entry_id as string | null | undefined) ?? null,
            title: String(updated.title ?? ''),
            notes: (updated.notes as string | null | undefined) ?? null,
            status: String(updated.status ?? 'scheduled'),
            scheduled_start: toIsoString(updated.scheduled_start),
            scheduled_end: toIsoString(updated.scheduled_end),
            work_item_id: (updated.work_item_id as string | null | undefined) ?? null,
            work_item_type: (updated.work_item_type as string | null | undefined) ?? null,
            is_private: Boolean(updated.is_private),
            is_recurring: Boolean(updated.is_recurring),
            assigned_user_ids: normalizeStringArray((updated.assigned_user_ids as string[] | undefined) ?? before.assigned_user_ids),
          });

          if (conflictMode === 'override' && detectedConflicts.length > 0) {
            const nowIso = new Date().toISOString();
            const uniqueConflicts = Array.from(new Set(detectedConflicts.map((row) => row.entry_id))).filter((id) => id !== updatedEntry.entry_id);
            for (const conflictingEntryId of uniqueConflicts) {
              await tx.trx('schedule_conflicts').insert({
                tenant: tx.tenantId,
                conflict_id: uuidv4(),
                entry_id_1: updatedEntry.entry_id,
                entry_id_2: conflictingEntryId,
                conflict_type: 'overlap',
                resolved: false,
                created_at: nowIso,
                updated_at: nowIso,
              });
            }
          }

          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:scheduling.reschedule',
            changedData: {
              entry_id: input.entry_id,
              updated_entry_id: updatedEntry.entry_id,
              previous_start: before.scheduled_start,
              previous_end: before.scheduled_end,
              new_start: updatedEntry.scheduled_start,
              new_end: updatedEntry.scheduled_end,
              recurrence_scope: recurrenceScope,
              conflict_mode: conflictMode,
            },
            details: {
              action_id: 'scheduling.reschedule',
              action_version: 1,
              reason: input.reason ?? null,
              note: input.note ?? null,
            },
          });

          let eventType: 'APPOINTMENT_RESCHEDULED' | null = null;
          const beforeAppointmentEntry = toAppointmentScheduleEntry(before);
          const updatedAppointmentEntry = toAppointmentScheduleEntry(updatedEntry);
          if (shouldEmitAppointmentEvents(updatedAppointmentEntry)) {
            eventType = 'APPOINTMENT_RESCHEDULED';
            await publishWorkflowDomainEvent({
              eventType,
              payload: buildAppointmentRescheduledPayload({
                before: beforeAppointmentEntry,
                after: updatedAppointmentEntry,
                ticketId: getTicketIdFromScheduleEntry(updatedAppointmentEntry),
                timezone: input.timezone ?? 'UTC',
              }),
              tenantId: tx.tenantId,
              occurredAt: new Date().toISOString(),
              actorUserId: tx.actorUserId,
              idempotencyKey: `appointment_rescheduled:${updatedEntry.entry_id}:${updatedEntry.scheduled_start}:${updatedEntry.scheduled_end}`,
            });
          }

          return {
            entry_id: input.entry_id,
            updated_entry_id: updatedEntry.entry_id,
            previous_start: before.scheduled_start,
            previous_end: before.scheduled_end,
            new_start: updatedEntry.scheduled_start,
            new_end: updatedEntry.scheduled_end,
            assigned_user_ids: updatedEntry.assigned_user_ids,
            conflict_mode: conflictMode,
            conflicts_detected: detectedConflicts.length,
            recurrence_scope: recurrenceScope,
            event_type: eventType,
          };
        });
      } catch (error) {
        if (isActionErrorLike(error)) throw error;
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  registry.register({
    id: 'scheduling.reassign',
    version: 1,
    inputSchema: z.object({
      entry_id: scheduleEntryRefSchema,
      assigned_user_ids: z.array(withWorkflowPicker(uuidSchema, 'Technician user id', 'user')).min(1).describe('One or more technician user ids'),
      mode: z.enum(['replace', 'add']).default('replace'),
      recurrence_scope: recurrenceScopeSchema.default('single'),
      no_op_if_already_assigned: z.boolean().default(true),
      reason: z.string().trim().min(1).optional(),
      comment: z.string().trim().min(1).optional(),
    }).refine((value) => normalizeStringArray(value.assigned_user_ids).length === value.assigned_user_ids.length, {
      message: 'assigned_user_ids must be unique',
      path: ['assigned_user_ids'],
    }),
    outputSchema: z.object({
      entry_id: z.string().min(1),
      updated_entry_id: z.string().min(1),
      previous_assigned_user_ids: z.array(uuidSchema),
      assigned_user_ids: z.array(uuidSchema),
      changed: z.boolean(),
      recurrence_scope: recurrenceScopeSchema,
      events_emitted: z.number().int().min(0),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Reassign Entry', category: 'Business Operations', description: 'Replace or add assigned technicians on a schedule entry' },
    handler: async (input, ctx) => {
      try {
        return await withTenantTransaction(ctx, async (tx) => {
          await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'update' });

          const before = await loadEntryByReference(tx, input.entry_id);
          if (!before) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          const recurrenceScope = normalizeRecurrenceScope(input.recurrence_scope);
          const requestedAssignees = normalizeStringArray(input.assigned_user_ids);
          await ensureTechnicianEligibility(ctx, tx, requestedAssignees);

          const previousAssignees = normalizeStringArray(before.assigned_user_ids);
          const nextAssignees = input.mode === 'replace'
            ? requestedAssignees
            : normalizeStringArray([...previousAssignees, ...requestedAssignees]);

          if (input.no_op_if_already_assigned && isSameUserSet(previousAssignees, nextAssignees)) {
            return {
              entry_id: input.entry_id,
              updated_entry_id: before.entry_id,
              previous_assigned_user_ids: previousAssignees,
              assigned_user_ids: previousAssignees,
              changed: false,
              recurrence_scope: recurrenceScope,
              events_emitted: 0,
            };
          }

          const nextNotes = appendEntryNotes(before.notes, [input.reason ? `Reassign reason: ${input.reason}` : undefined, input.comment]) ?? undefined;
          const recurrenceAnchors = getVirtualOccurrenceAnchors(input.entry_id, recurrenceScope, before);
          const updated = await ScheduleEntry.update(
            tx.trx,
            tx.tenantId,
            input.entry_id,
            {
              assigned_user_ids: nextAssignees,
              notes: nextNotes,
              ...recurrenceAnchors,
            },
            toRecurrenceScope(recurrenceScope)
          );

          if (!updated) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          const updatedEntry = parseSchedulingEntrySummary({
            entry_id: updated.entry_id,
            original_entry_id: (updated.original_entry_id as string | null | undefined) ?? null,
            title: String(updated.title ?? ''),
            notes: (updated.notes as string | null | undefined) ?? null,
            status: String(updated.status ?? 'scheduled'),
            scheduled_start: toIsoString(updated.scheduled_start),
            scheduled_end: toIsoString(updated.scheduled_end),
            work_item_id: (updated.work_item_id as string | null | undefined) ?? null,
            work_item_type: (updated.work_item_type as string | null | undefined) ?? null,
            is_private: Boolean(updated.is_private),
            is_recurring: Boolean(updated.is_recurring),
            assigned_user_ids: normalizeStringArray((updated.assigned_user_ids as string[] | undefined) ?? nextAssignees),
          });

          const newlyAssigned = updatedEntry.assigned_user_ids.filter((userId) => !previousAssignees.includes(userId));

          let eventsEmitted = 0;
          const updatedAppointmentEntry = toAppointmentScheduleEntry(updatedEntry);
          if (shouldEmitAppointmentEvents(updatedAppointmentEntry)) {
            for (const newAssigneeId of newlyAssigned) {
              await publishWorkflowDomainEvent({
                eventType: 'APPOINTMENT_ASSIGNED',
                payload: buildAppointmentAssignedPayload({
                  appointmentId: updatedEntry.entry_id,
                  ticketId: getTicketIdFromScheduleEntry(updatedAppointmentEntry),
                  previousAssigneeId: previousAssignees.length === 1 ? previousAssignees[0] : undefined,
                  newAssigneeId,
                }),
                tenantId: tx.tenantId,
                occurredAt: new Date().toISOString(),
                actorUserId: tx.actorUserId,
                idempotencyKey: `appointment_assigned:${updatedEntry.entry_id}:${newAssigneeId}:${recurrenceScope}`,
              });
              eventsEmitted += 1;
            }
          }

          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:scheduling.reassign',
            changedData: {
              entry_id: input.entry_id,
              updated_entry_id: updatedEntry.entry_id,
              previous_assigned_user_ids: previousAssignees,
              assigned_user_ids: updatedEntry.assigned_user_ids,
              recurrence_scope: recurrenceScope,
              mode: input.mode,
            },
            details: {
              action_id: 'scheduling.reassign',
              action_version: 1,
              reason: input.reason ?? null,
              comment: input.comment ?? null,
              events_emitted: eventsEmitted,
            },
          });

          return {
            entry_id: input.entry_id,
            updated_entry_id: updatedEntry.entry_id,
            previous_assigned_user_ids: previousAssignees,
            assigned_user_ids: updatedEntry.assigned_user_ids,
            changed: true,
            recurrence_scope: recurrenceScope,
            events_emitted: eventsEmitted,
          };
        });
      } catch (error) {
        if (isActionErrorLike(error)) throw error;
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  registry.register({
    id: 'scheduling.cancel',
    version: 1,
    inputSchema: z.object({
      entry_id: scheduleEntryRefSchema,
      recurrence_scope: recurrenceScopeSchema.default('single'),
      reason: z.string().trim().min(1).optional(),
      note: z.string().trim().min(1).optional(),
    }),
    outputSchema: z.object({
      entry_id: z.string().min(1),
      updated_entry_id: z.string().min(1),
      status: z.string(),
      recurrence_scope: recurrenceScopeSchema,
      reason: z.string().nullable(),
      event_type: z.enum(['APPOINTMENT_CANCELED']).nullable(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Cancel Entry', category: 'Business Operations', description: 'Mark a schedule entry canceled without deleting it' },
    handler: async (input, ctx) => {
      try {
        return await withTenantTransaction(ctx, async (tx) => {
          await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'update' });

          const before = await loadEntryByReference(tx, input.entry_id);
          if (!before) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          const recurrenceScope = normalizeRecurrenceScope(input.recurrence_scope);
          const nextNotes = appendEntryNotes(before.notes, [input.reason ? `Cancellation reason: ${input.reason}` : undefined, input.note]) ?? undefined;
          const recurrenceAnchors = getVirtualOccurrenceAnchors(input.entry_id, recurrenceScope, before);
          const updated = await ScheduleEntry.update(
            tx.trx,
            tx.tenantId,
            input.entry_id,
            {
              status: 'cancelled',
              notes: nextNotes,
              ...recurrenceAnchors,
            },
            toRecurrenceScope(recurrenceScope)
          );

          if (!updated) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          const updatedEntry = parseSchedulingEntrySummary({
            entry_id: updated.entry_id,
            original_entry_id: (updated.original_entry_id as string | null | undefined) ?? null,
            title: String(updated.title ?? ''),
            notes: (updated.notes as string | null | undefined) ?? null,
            status: String(updated.status ?? 'cancelled'),
            scheduled_start: toIsoString(updated.scheduled_start),
            scheduled_end: toIsoString(updated.scheduled_end),
            work_item_id: (updated.work_item_id as string | null | undefined) ?? null,
            work_item_type: (updated.work_item_type as string | null | undefined) ?? null,
            is_private: Boolean(updated.is_private),
            is_recurring: Boolean(updated.is_recurring),
            assigned_user_ids: normalizeStringArray((updated.assigned_user_ids as string[] | undefined) ?? before.assigned_user_ids),
          });

          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:scheduling.cancel',
            changedData: {
              entry_id: input.entry_id,
              updated_entry_id: updatedEntry.entry_id,
              status: updatedEntry.status,
              recurrence_scope: recurrenceScope,
            },
            details: {
              action_id: 'scheduling.cancel',
              action_version: 1,
              reason: input.reason ?? null,
              note: input.note ?? null,
            },
          });

          let eventType: 'APPOINTMENT_CANCELED' | null = null;
          const updatedAppointmentEntry = toAppointmentScheduleEntry(updatedEntry);
          if (shouldEmitAppointmentEvents(updatedAppointmentEntry) && isAppointmentCanceledStatus(updatedEntry.status)) {
            eventType = 'APPOINTMENT_CANCELED';
            await publishWorkflowDomainEvent({
              eventType,
              payload: buildAppointmentCanceledPayload({
                appointmentId: updatedEntry.entry_id,
                ticketId: getTicketIdFromScheduleEntry(updatedAppointmentEntry),
                reason: input.reason,
              }),
              tenantId: tx.tenantId,
              occurredAt: new Date().toISOString(),
              actorUserId: tx.actorUserId,
              idempotencyKey: `appointment_canceled:${updatedEntry.entry_id}:${recurrenceScope}:${input.reason ?? ''}`,
            });
          }

          return {
            entry_id: input.entry_id,
            updated_entry_id: updatedEntry.entry_id,
            status: updatedEntry.status,
            recurrence_scope: recurrenceScope,
            reason: input.reason ?? null,
            event_type: eventType,
          };
        });
      } catch (error) {
        if (isActionErrorLike(error)) throw error;
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  registry.register({
    id: 'scheduling.complete',
    version: 1,
    inputSchema: z.object({
      entry_id: scheduleEntryRefSchema,
      recurrence_scope: recurrenceScopeSchema.default('single'),
      outcome: z.string().trim().min(1).optional(),
      note: z.string().trim().min(1).optional(),
    }),
    outputSchema: z.object({
      entry_id: z.string().min(1),
      updated_entry_id: z.string().min(1),
      status: z.string(),
      completed_at: isoDateTimeSchema,
      outcome: z.string().nullable(),
      event_type: z.enum(['APPOINTMENT_COMPLETED']).nullable(),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Complete Entry', category: 'Business Operations', description: 'Mark a schedule entry completed' },
    handler: async (input, ctx) => {
      try {
        return await withTenantTransaction(ctx, async (tx) => {
          await requirePermission(ctx, tx, { resource: 'user_schedule', action: 'update' });

          const before = await loadEntryByReference(tx, input.entry_id);
          if (!before) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          const recurrenceScope = normalizeRecurrenceScope(input.recurrence_scope);
          const completedAt = new Date().toISOString();
          const nextNotes = appendEntryNotes(before.notes, [input.outcome ? `Completion outcome: ${input.outcome}` : undefined, input.note]) ?? undefined;
          const recurrenceAnchors = getVirtualOccurrenceAnchors(input.entry_id, recurrenceScope, before);
          const updated = await ScheduleEntry.update(
            tx.trx,
            tx.tenantId,
            input.entry_id,
            {
              status: 'completed',
              notes: nextNotes,
              ...recurrenceAnchors,
            },
            toRecurrenceScope(recurrenceScope)
          );

          if (!updated) {
            throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Schedule entry not found', details: { entry_id: input.entry_id } });
          }

          const updatedEntry = parseSchedulingEntrySummary({
            entry_id: updated.entry_id,
            original_entry_id: (updated.original_entry_id as string | null | undefined) ?? null,
            title: String(updated.title ?? ''),
            notes: (updated.notes as string | null | undefined) ?? null,
            status: String(updated.status ?? 'completed'),
            scheduled_start: toIsoString(updated.scheduled_start),
            scheduled_end: toIsoString(updated.scheduled_end),
            work_item_id: (updated.work_item_id as string | null | undefined) ?? null,
            work_item_type: (updated.work_item_type as string | null | undefined) ?? null,
            is_private: Boolean(updated.is_private),
            is_recurring: Boolean(updated.is_recurring),
            assigned_user_ids: normalizeStringArray((updated.assigned_user_ids as string[] | undefined) ?? before.assigned_user_ids),
          });

          await writeRunAudit(ctx, tx, {
            operation: 'workflow_action:scheduling.complete',
            changedData: {
              entry_id: input.entry_id,
              updated_entry_id: updatedEntry.entry_id,
              status: updatedEntry.status,
              recurrence_scope: recurrenceScope,
              completed_at: completedAt,
            },
            details: {
              action_id: 'scheduling.complete',
              action_version: 1,
              outcome: input.outcome ?? null,
              note: input.note ?? null,
            },
          });

          let eventType: 'APPOINTMENT_COMPLETED' | null = null;
          const updatedAppointmentEntry = toAppointmentScheduleEntry(updatedEntry);
          if (shouldEmitAppointmentEvents(updatedAppointmentEntry) && isAppointmentCompletedStatus(updatedEntry.status) && !isAppointmentNoShowStatus(updatedEntry.status)) {
            eventType = 'APPOINTMENT_COMPLETED';
            await publishWorkflowDomainEvent({
              eventType,
              payload: buildAppointmentCompletedPayload({
                appointmentId: updatedEntry.entry_id,
                ticketId: getTicketIdFromScheduleEntry(updatedAppointmentEntry),
                outcome: input.outcome,
              }),
              tenantId: tx.tenantId,
              occurredAt: completedAt,
              actorUserId: tx.actorUserId,
              idempotencyKey: `appointment_completed:${updatedEntry.entry_id}:${recurrenceScope}:${input.outcome ?? ''}`,
            });
          }

          return {
            entry_id: input.entry_id,
            updated_entry_id: updatedEntry.entry_id,
            status: updatedEntry.status,
            completed_at: completedAt,
            outcome: input.outcome ?? null,
            event_type: eventType,
          };
        });
      } catch (error) {
        if (isActionErrorLike(error)) throw error;
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
      }
    },
  });
}
