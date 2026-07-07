import { randomUUID } from 'node:crypto';
import {
  User,
  computeWorkDateFields,
  createTenantKnex,
  resolveUserTimeZone,
  tenantDb,
  truncateToMinute,
  withTransaction,
  type ServiceContext,
} from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';

export interface TeamsTicketRecord {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  status_name?: string | null;
  status_is_closed?: boolean | null;
  priority_name?: string | null;
  client_name?: string | null;
  contact_name?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
}

export interface TeamsProjectTaskRecord {
  task_id: string;
  project_id: string | null;
  task_name: string | null;
  description: string | null;
}

export interface TeamsContactRecord {
  contact_name_id: string;
  client_id: string | null;
  full_name: string | null;
  email: string | null;
  role: string | null;
  client_name?: string | null;
}

export interface TeamsTimeEntryRecord {
  entry_id: string;
  work_item_id: string | null;
  work_item_type: string | null;
  project_id?: string | null;
}

export interface TeamsApprovalRecord {
  id: string;
  approval_status: string | null;
}

export interface TeamsPendingApprovalRecord {
  id: string;
  approval_status: string | null;
  first_name: string | null;
  last_name: string | null;
  period_start_date: string | null;
  period_end_date: string | null;
}

// Raw.as() is not reliably available on knex Raw instances after bundling —
// the production build throws `j(...).as is not a function`. Embed the AS
// clause directly in the raw SQL to avoid the prototype call entirely. Both
// tableAlias and outputAlias are hard-coded by the callers, so string
// interpolation here cannot become a SQL injection vector.
function fullNameExpression(knex: any, tableAlias: string, outputAlias: string): any {
  return knex.raw(
    `CASE WHEN ${tableAlias}.first_name IS NOT NULL AND ${tableAlias}.last_name IS NOT NULL THEN CONCAT(${tableAlias}.first_name, ' ', ${tableAlias}.last_name) ELSE NULL END AS ${outputAlias}`
  );
}

function buildTeamsTicketBaseQuery(knex: any, tenant: string) {
  const db = tenantDb(knex, tenant);
  const query = db.table('tickets as t');
  db.tenantJoin(query, 'clients as comp', 't.client_id', 'comp.client_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as cont', 't.contact_name_id', 'cont.contact_name_id', { type: 'left' });
  db.tenantJoin(query, 'statuses as stat', 't.status_id', 'stat.status_id', { type: 'left' });
  db.tenantJoin(query, 'priorities as pri', 't.priority_id', 'pri.priority_id', { type: 'left' });
  db.tenantJoin(query, 'users as assigned_user', 't.assigned_to', 'assigned_user.user_id', { type: 'left' });

  return query.select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.assigned_to',
      'comp.client_name',
      'cont.full_name as contact_name',
      'stat.name as status_name',
      'stat.is_closed as status_is_closed',
      'pri.priority_name',
      fullNameExpression(knex, 'assigned_user', 'assigned_to_name')
    );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getTeamsTicketById(
  ticketId: string,
  context: ServiceContext
): Promise<TeamsTicketRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const ticket = await buildTeamsTicketBaseQuery(knex, context.tenant)
    .where('t.ticket_id', ticketId)
    .first();

  return (ticket as TeamsTicketRecord | undefined) ?? null;
}

export async function resolveTeamsTicketByReference(
  reference: string,
  context: ServiceContext
): Promise<TeamsTicketRecord | null> {
  // Accept human forms with a leading '#' ("ticket #1234").
  const trimmed = reference.trim().replace(/^#/, '');
  if (!trimmed) return null;

  const { knex } = await createTenantKnex(context.tenant);

  // Try exact match on ticket_number first (case-insensitive) — this is the
  // human-friendly identifier users will type in bot commands.
  const byNumber = await buildTeamsTicketBaseQuery(knex, context.tenant)
    .whereRaw('LOWER("t"."ticket_number") = ?', [trimmed.toLowerCase()])
    .first();
  if (byNumber) return byNumber as TeamsTicketRecord;

  // Purely numeric references also match prefixed/zero-padded ticket numbers
  // (e.g. "1833" resolves alga0001833). Tenant scoping comes from the base
  // query, so identical numbers in other tenants never leak.
  if (/^\d+$/.test(trimmed)) {
    const byNumericSuffix = await buildTeamsTicketBaseQuery(knex, context.tenant)
      .whereRaw('"t"."ticket_number" ~* ?', [`^[^0-9]*0*${trimmed}$`])
      .first();
    if (byNumericSuffix) return byNumericSuffix as TeamsTicketRecord;
  }

  // Fall back to ticket_id lookup only when the reference looks like a UUID.
  if (UUID_PATTERN.test(trimmed)) {
    const byId = await buildTeamsTicketBaseQuery(knex, context.tenant)
      .where('t.ticket_id', trimmed)
      .first();
    return (byId as TeamsTicketRecord | undefined) ?? null;
  }

  return null;
}

export interface TeamsClientRecord {
  client_id: string;
  client_name: string | null;
}

export async function searchTeamsClientsByName(params: {
  tenantId: string;
  name: string;
  limit: number;
}): Promise<TeamsClientRecord[]> {
  const trimmed = params.name.trim();
  if (!trimmed) return [];

  const { knex } = await createTenantKnex(params.tenantId);
  const rows = await tenantDb(knex, params.tenantId).table('clients')
    .where('is_inactive', false)
    .whereILike('client_name', `%${trimmed}%`)
    .select('client_id', 'client_name')
    .orderBy('client_name', 'asc')
    .limit(params.limit);

  return rows as TeamsClientRecord[];
}

export async function listTeamsActiveClients(params: {
  tenantId: string;
  limit: number;
}): Promise<TeamsClientRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const rows = await tenantDb(knex, params.tenantId).table('clients')
    .where('is_inactive', false)
    .select('client_id', 'client_name')
    .orderBy('client_name', 'asc')
    .limit(params.limit);

  return rows as TeamsClientRecord[];
}

export interface TeamsTicketCreationDefaults {
  boardId: string | null;
  statusId: string | null;
}

/**
 * Default board + open status used when a ticket is created from a bot chat
 * command (no picker UI). Prefers the tenant default board, then that
 * board's default open status.
 */
export async function getTeamsTicketCreationDefaults(params: {
  tenantId: string;
}): Promise<TeamsTicketCreationDefaults> {
  const { knex } = await createTenantKnex(params.tenantId);
  const db = tenantDb(knex, params.tenantId);

  const board = (await db.table('boards')
    .where('is_inactive', false)
    .select('board_id')
    .orderBy([
      { column: 'is_default', order: 'desc' },
      { column: 'board_name', order: 'asc' },
    ])
    .first()) as { board_id?: string | null } | undefined;

  const boardId = board?.board_id ?? null;
  if (!boardId) {
    return { boardId: null, statusId: null };
  }

  const status = (await db.table('statuses')
    .where({ status_type: 'ticket', is_closed: false })
    .where((builder: any) => {
      builder.where('board_id', boardId).orWhereNull('board_id');
    })
    .select('status_id')
    .orderBy([
      { column: 'is_default', order: 'desc' },
      { column: 'order_number', order: 'asc' },
    ])
    .first()) as { status_id?: string | null } | undefined;

  return { boardId, statusId: status?.status_id ?? null };
}

export async function listAssignedOpenTeamsTickets(params: {
  tenantId: string;
  assignedToUserId: string;
  limit: number;
}): Promise<TeamsTicketRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const rows = await buildTeamsTicketBaseQuery(knex, params.tenantId)
    .andWhere('t.assigned_to', params.assignedToUserId)
    .andWhere((builder: any) => {
      builder.where('stat.is_closed', false).orWhereNull('stat.is_closed');
    })
    .orderBy('t.entered_at', 'desc')
    .limit(params.limit);

  return rows as TeamsTicketRecord[];
}

export async function searchTeamsTickets(params: {
  tenantId: string;
  query: string;
  limit: number;
  includeClosed?: boolean;
}): Promise<TeamsTicketRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const rows = await buildTeamsTicketBaseQuery(knex, params.tenantId)
    .modify((builder: any) => {
      if (!params.includeClosed) {
        builder.where((sub: any) => {
          sub.where('stat.is_closed', false).orWhereNull('stat.is_closed');
        });
      }
    })
    .where((builder: any) => {
      builder
        .whereILike('t.title', `%${params.query}%`)
        .orWhereILike('t.ticket_number', `%${params.query}%`)
        .orWhereILike('comp.client_name', `%${params.query}%`)
        .orWhereILike('cont.full_name', `%${params.query}%`);
    })
    .orderBy('t.entered_at', 'desc')
    .limit(params.limit);

  return rows as TeamsTicketRecord[];
}

export async function updateTeamsTicketAssignee(params: {
  ticketId: string;
  tenantId: string;
  assigneeId: string;
  actorUserId: string;
}): Promise<void> {
  const { knex } = await createTenantKnex(params.tenantId);
  await tenantDb(knex, params.tenantId).table('tickets')
    .where({ ticket_id: params.ticketId })
    .update({
      assigned_to: params.assigneeId,
      updated_by: params.actorUserId,
      updated_at: knex.raw('now()'),
    });
}

export async function addTeamsTicketComment(params: {
  ticketId: string;
  tenantId: string;
  actorUserId: string;
  commentText: string;
  isInternal: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { knex } = await createTenantKnex(params.tenantId);
  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, params.tenantId);
    const ticket = await db.table('tickets')
      .where({ ticket_id: params.ticketId })
      .first('ticket_id');

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // comments.thread_id is NOT NULL — create the thread row first.
    const teamsCommentId = randomUUID();
    const teamsThreadId = randomUUID();
    const teamsNowIso = new Date().toISOString();

    await db.table('comment_threads').insert({
      tenant: params.tenantId,
      thread_id: teamsThreadId,
      ticket_id: params.ticketId,
      project_task_id: null,
      root_comment_id: teamsCommentId,
      is_internal: params.isInternal,
      reply_count: 0,
      last_activity_at: teamsNowIso,
      created_at: teamsNowIso,
      created_by: params.actorUserId || null,
    });

    await db.table('comments').insert({
      comment_id: teamsCommentId,
      thread_id: teamsThreadId,
      ticket_id: params.ticketId,
      note: params.commentText,
      is_internal: params.isInternal,
      is_resolution: false,
      user_id: params.actorUserId,
      tenant: params.tenantId,
      created_at: teamsNowIso,
      updated_at: teamsNowIso,
      metadata: params.metadata,
    });

    await db.table('tickets')
      .where({ ticket_id: params.ticketId })
      .update({
        updated_by: params.actorUserId,
        updated_at: trx.raw('now()'),
      });
  });
}

export async function getTeamsProjectTaskById(
  taskId: string,
  context: ServiceContext
): Promise<TeamsProjectTaskRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const task = await tenantDb(knex, context.tenant).table('project_tasks')
    .where({ task_id: taskId })
    .select('task_id', 'project_id', 'task_name', 'description')
    .first();

  return (task as TeamsProjectTaskRecord | undefined) ?? null;
}

export async function listTeamsProjectTasks(
  projectId: string,
  context: ServiceContext
): Promise<TeamsProjectTaskRecord[]> {
  const { knex } = await createTenantKnex(context.tenant);
  const rows = await tenantDb(knex, context.tenant).table('project_tasks')
    .where({ project_id: projectId })
    .select('task_id', 'project_id', 'task_name', 'description')
    .orderBy([{ column: 'order_key', order: 'asc' }, { column: 'wbs_code', order: 'asc' }]);

  return rows as TeamsProjectTaskRecord[];
}

export async function getTeamsContactById(
  contactId: string,
  context: ServiceContext
): Promise<TeamsContactRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const db = tenantDb(knex, context.tenant);
  const contactQuery = db.table('contacts as c');
  db.tenantJoin(contactQuery, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });

  const contact = await contactQuery
    .where({ 'c.contact_name_id': contactId })
    .select('c.contact_name_id', 'c.client_id', 'c.full_name', 'c.email', 'c.role', 'comp.client_name')
    .first();

  return (contact as unknown as TeamsContactRecord | undefined) ?? null;
}

export async function searchTeamsContacts(params: {
  tenantId: string;
  query: string;
  limit: number;
}): Promise<TeamsContactRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const db = tenantDb(knex, params.tenantId);
  const normalizedDigits = params.query.replace(/\D/g, '');
  const contactQuery = db.table('contacts as c');
  db.tenantJoin(contactQuery, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });

  const rows = await contactQuery
    .andWhere('c.is_inactive', false)
    .where((builder: any) => {
      builder
        .whereILike('c.full_name', `%${params.query}%`)
        .orWhereILike('c.email', `%${params.query}%`)
        .orWhereILike('c.role', `%${params.query}%`)
        .orWhereILike('comp.client_name', `%${params.query}%`)
        .orWhereExists(
          db.subquery('contact_phone_numbers as cpn')
            .select(knex.raw('1'))
            .andWhereRaw('cpn.contact_name_id = c.contact_name_id')
            .andWhere(function matchPhone(this: any) {
              this.whereILike('cpn.phone_number', `%${params.query}%`);
              if (normalizedDigits) {
                this.orWhere('cpn.normalized_phone_number', 'like', `%${normalizedDigits}%`);
              }
            })
        );
    })
    .select('c.contact_name_id', 'c.client_id', 'c.full_name', 'c.email', 'c.role', 'comp.client_name')
    .orderBy('c.full_name', 'asc')
    .limit(params.limit);

  return rows as unknown as TeamsContactRecord[];
}

export async function getTeamsTimeEntryById(
  entryId: string,
  context: ServiceContext
): Promise<TeamsTimeEntryRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const entry = await tenantDb(knex, context.tenant).table('time_entries')
    .where({ entry_id: entryId })
    .select('entry_id', 'work_item_id', 'work_item_type')
    .first();

  return (entry as TeamsTimeEntryRecord | undefined) ?? null;
}

export async function createTeamsTimeEntry(params: {
  tenantId: string;
  actorUserId: string;
  workItemType: 'ticket' | 'project_task';
  workItemId: string;
  startTime: string;
  endTime: string;
  notes: string;
  billable: boolean;
}): Promise<TeamsTimeEntryRecord> {
  const { knex } = await createTenantKnex(params.tenantId);
  const userTimeZone = await resolveUserTimeZone(knex, params.tenantId, params.actorUserId);
  const { work_date, work_timezone } = computeWorkDateFields(params.startTime, userTimeZone);
  // LEVERAGE: pattern time-entry-duration-persist — same normalize-to-minute + round shape used
  // by TimeEntryService and the workflow runtime. Teams supplies real meeting instants, so the
  // seconds must be dropped here too or stored entries reproduce the off-by-one duration bug.
  const startTime = truncateToMinute(params.startTime);
  const endTime = truncateToMinute(params.endTime);
  const billableDuration = Math.max(
    0,
    Math.round((endTime.getTime() - startTime.getTime()) / 60000)
  );
  const entryId = randomUUID();

  let projectId: string | null = null;
  if (params.workItemType === 'project_task') {
    const task = await tenantDb(knex, params.tenantId).table('project_tasks')
      .where({ task_id: params.workItemId })
      .select('project_id')
      .first();
    projectId = (task as { project_id?: string | null } | undefined)?.project_id ?? null;
  }

  await tenantDb(knex, params.tenantId).table('time_entries').insert({
    tenant: params.tenantId,
    entry_id: entryId,
    user_id: params.actorUserId,
    start_time: startTime,
    end_time: endTime,
    work_date,
    work_timezone,
    notes: params.notes || null,
    work_item_id: params.workItemId,
    work_item_type: params.workItemType,
    billable_duration: params.billable ? billableDuration : 0,
    approval_status: 'DRAFT',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: params.actorUserId,
    updated_by: params.actorUserId,
  });

  return {
    entry_id: entryId,
    work_item_id: params.workItemId,
    work_item_type: params.workItemType,
    project_id: projectId,
  };
}

export async function getTeamsApprovalById(
  approvalId: string,
  context: ServiceContext
): Promise<TeamsApprovalRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const approval = await tenantDb(knex, context.tenant).table('time_sheets')
    .where({ id: approvalId })
    .select('id', 'approval_status')
    .first();

  return (approval as TeamsApprovalRecord | undefined) ?? null;
}

export async function approveTeamsTimeSheet(params: {
  approvalId: string;
  tenantId: string;
  actorUserId: string;
  approvalNotes?: string;
}): Promise<void> {
  const { knex } = await createTenantKnex(params.tenantId);
  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, params.tenantId);

    await db.table('time_sheets')
      .where({ id: params.approvalId })
      .update({
        approval_status: 'APPROVED',
        approved_at: new Date(),
        approved_by: params.actorUserId,
        approval_notes: params.approvalNotes,
        updated_at: new Date(),
      });

    await db.table('time_entries')
      .where({ time_sheet_id: params.approvalId })
      .update({
        approval_status: 'APPROVED',
        approved_at: new Date(),
        approved_by: params.actorUserId,
        updated_at: new Date(),
      });

    if (params.approvalNotes) {
      await db.table('time_sheet_comments').insert({
        time_sheet_id: params.approvalId,
        user_id: params.actorUserId,
        comment_text: params.approvalNotes,
        user_role: 'approver',
        tenant: params.tenantId,
        created_at: new Date(),
      });
    }
  });
}

export async function requestChangesForTeamsTimeSheet(params: {
  approvalId: string;
  tenantId: string;
  actorUserId: string;
  changeReason: string;
  detailedFeedback: string;
}): Promise<void> {
  const { knex } = await createTenantKnex(params.tenantId);
  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, params.tenantId);

    await db.table('time_sheets')
      .where({ id: params.approvalId })
      .update({
        approval_status: 'CHANGES_REQUESTED',
        change_reason: params.changeReason,
        detailed_feedback: params.detailedFeedback,
        updated_at: new Date(),
      });

    await db.table('time_sheet_comments').insert({
      time_sheet_id: params.approvalId,
      user_id: params.actorUserId,
      comment_text: `Changes requested: ${params.changeReason}${params.detailedFeedback ? `\n\nDetails: ${params.detailedFeedback}` : ''}`,
      user_role: 'approver',
      tenant: params.tenantId,
      created_at: new Date(),
    });
  });
}

export async function listPendingApprovalsForTeams(params: {
  tenantId: string;
  user: IUserWithRoles;
  limit: number;
  query?: string;
}): Promise<TeamsPendingApprovalRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const db = tenantDb(knex, params.tenantId);
  const canReadAll = await hasPermission(params.user, 'timesheet', 'read_all', knex);
  const normalizedQuery = params.query?.trim();

  let query = db.table('time_sheets');
  db.tenantJoin(query, 'users', 'time_sheets.user_id', 'users.user_id');
  db.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');

  query = query.whereIn('time_sheets.approval_status', ['SUBMITTED', 'CHANGES_REQUESTED'])
    .select(
      'time_sheets.id',
      'time_sheets.approval_status',
      'users.first_name',
      'users.last_name',
      'time_periods.start_date as period_start_date',
      'time_periods.end_date as period_end_date'
    )
    .orderBy('time_sheets.submitted_at', 'asc')
    .limit(params.limit);

  if (normalizedQuery) {
    query = query.where((builder: any) => {
      builder
        .whereILike('time_sheets.id', `%${normalizedQuery}%`)
        .orWhereILike('users.first_name', `%${normalizedQuery}%`)
        .orWhereILike('users.last_name', `%${normalizedQuery}%`)
        .orWhere(knex.raw(`CONCAT(users.first_name, ' ', users.last_name)`), 'ilike', `%${normalizedQuery}%`);
    });
  }

  if (!canReadAll) {
    const reportsToUserIds = await User.getReportsToSubordinateIds(knex, params.user.user_id);

    query = query
      .where((builder: any) => {
        const managerScope = db.subquery('team_members')
          .select(knex.raw('1'));
        db.tenantJoin(managerScope, 'teams', 'team_members.team_id', 'teams.team_id');

        builder.whereExists(
          managerScope
            .where('team_members.user_id', knex.ref('users.user_id'))
            .andWhere('teams.manager_id', params.user.user_id)
        );

        if (reportsToUserIds.length > 0) {
          builder.orWhereIn('users.user_id', reportsToUserIds);
        }
      })
      .distinct();
  }

  return (await query) as TeamsPendingApprovalRecord[];
}
