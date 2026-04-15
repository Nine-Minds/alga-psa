import { randomUUID } from 'node:crypto';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import {
  User,
  computeWorkDateFields,
  createTenantKnex,
  resolveUserTimeZone,
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

export async function getTeamsTicketById(
  ticketId: string,
  context: ServiceContext
): Promise<TeamsTicketRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const ticket = await knex('tickets as t')
    .leftJoin('clients as comp', function joinClients() {
      this.on('t.client_id', '=', 'comp.client_id').andOn('t.tenant', '=', 'comp.tenant');
    })
    .leftJoin('contacts as cont', function joinContacts() {
      this.on('t.contact_name_id', '=', 'cont.contact_name_id').andOn('t.tenant', '=', 'cont.tenant');
    })
    .leftJoin('statuses as stat', function joinStatuses() {
      this.on('t.status_id', '=', 'stat.status_id').andOn('t.tenant', '=', 'stat.tenant');
    })
    .leftJoin('priorities as pri', function joinPriorities() {
      this.on('t.priority_id', '=', 'pri.priority_id').andOn('t.tenant', '=', 'pri.tenant');
    })
    .leftJoin('users as assigned_user', function joinAssignedUser() {
      this.on('t.assigned_to', '=', 'assigned_user.user_id').andOn('t.tenant', '=', 'assigned_user.tenant');
    })
    .where({ 't.tenant': context.tenant, 't.ticket_id': ticketId })
    .select(
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
    )
    .first();

  return (ticket as TeamsTicketRecord | undefined) ?? null;
}

export async function listAssignedOpenTeamsTickets(params: {
  tenantId: string;
  assignedToUserId: string;
  limit: number;
}): Promise<TeamsTicketRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const rows = await knex('tickets as t')
    .leftJoin('clients as comp', function joinClients() {
      this.on('t.client_id', '=', 'comp.client_id').andOn('t.tenant', '=', 'comp.tenant');
    })
    .leftJoin('contacts as cont', function joinContacts() {
      this.on('t.contact_name_id', '=', 'cont.contact_name_id').andOn('t.tenant', '=', 'cont.tenant');
    })
    .leftJoin('statuses as stat', function joinStatuses() {
      this.on('t.status_id', '=', 'stat.status_id').andOn('t.tenant', '=', 'stat.tenant');
    })
    .leftJoin('priorities as pri', function joinPriorities() {
      this.on('t.priority_id', '=', 'pri.priority_id').andOn('t.tenant', '=', 'pri.tenant');
    })
    .leftJoin('users as assigned_user', function joinAssignedUser() {
      this.on('t.assigned_to', '=', 'assigned_user.user_id').andOn('t.tenant', '=', 'assigned_user.tenant');
    })
    .where('t.tenant', params.tenantId)
    .andWhere('t.assigned_to', params.assignedToUserId)
    .andWhere((builder: any) => {
      builder.where('stat.is_closed', false).orWhereNull('stat.is_closed');
    })
    .select(
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
    )
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
  const rows = await knex('tickets as t')
    .leftJoin('clients as comp', function joinClients() {
      this.on('t.client_id', '=', 'comp.client_id').andOn('t.tenant', '=', 'comp.tenant');
    })
    .leftJoin('contacts as cont', function joinContacts() {
      this.on('t.contact_name_id', '=', 'cont.contact_name_id').andOn('t.tenant', '=', 'cont.tenant');
    })
    .leftJoin('statuses as stat', function joinStatuses() {
      this.on('t.status_id', '=', 'stat.status_id').andOn('t.tenant', '=', 'stat.tenant');
    })
    .where('t.tenant', params.tenantId)
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
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      'comp.client_name',
      'cont.full_name as contact_name'
    )
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
  await knex('tickets')
    .where({ tenant: params.tenantId, ticket_id: params.ticketId })
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
    const ticket = await trx('tickets')
      .where({ tenant: params.tenantId, ticket_id: params.ticketId })
      .first('ticket_id');

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    await trx('comments').insert({
      comment_id: randomUUID(),
      ticket_id: params.ticketId,
      note: params.commentText,
      is_internal: params.isInternal,
      is_resolution: false,
      user_id: params.actorUserId,
      tenant: params.tenantId,
      created_at: trx.raw('now()'),
      updated_at: trx.raw('now()'),
      metadata: params.metadata,
    });

    await trx('tickets')
      .where({ tenant: params.tenantId, ticket_id: params.ticketId })
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
  const task = await knex('project_tasks')
    .where({ tenant: context.tenant, task_id: taskId })
    .select('task_id', 'project_id', 'task_name', 'description')
    .first();

  return (task as TeamsProjectTaskRecord | undefined) ?? null;
}

export async function listTeamsProjectTasks(
  projectId: string,
  context: ServiceContext
): Promise<TeamsProjectTaskRecord[]> {
  const { knex } = await createTenantKnex(context.tenant);
  const rows = await knex('project_tasks')
    .where({ tenant: context.tenant, project_id: projectId })
    .select('task_id', 'project_id', 'task_name', 'description')
    .orderBy([{ column: 'order_key', order: 'asc' }, { column: 'wbs_code', order: 'asc' }]);

  return rows as TeamsProjectTaskRecord[];
}

export async function getTeamsContactById(
  contactId: string,
  context: ServiceContext
): Promise<TeamsContactRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const contact = await knex('contacts as c')
    .leftJoin('clients as comp', function joinClients() {
      this.on('c.client_id', '=', 'comp.client_id').andOn('c.tenant', '=', 'comp.tenant');
    })
    .where({ 'c.tenant': context.tenant, 'c.contact_name_id': contactId })
    .select('c.contact_name_id', 'c.client_id', 'c.full_name', 'c.email', 'c.role', 'comp.client_name')
    .first();

  return (contact as TeamsContactRecord | undefined) ?? null;
}

export async function searchTeamsContacts(params: {
  tenantId: string;
  query: string;
  limit: number;
}): Promise<TeamsContactRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const normalizedDigits = params.query.replace(/\D/g, '');
  const rows = await knex('contacts as c')
    .leftJoin('clients as comp', function joinClients() {
      this.on('c.client_id', '=', 'comp.client_id').andOn('c.tenant', '=', 'comp.tenant');
    })
    .where('c.tenant', params.tenantId)
    .andWhere('c.is_inactive', false)
    .where((builder: any) => {
      builder
        .whereILike('c.full_name', `%${params.query}%`)
        .orWhereILike('c.email', `%${params.query}%`)
        .orWhereILike('c.role', `%${params.query}%`)
        .orWhereILike('comp.client_name', `%${params.query}%`)
        .orWhereExists(function existsPhone(this: any) {
          this.select(knex.raw('1'))
            .from('contact_phone_numbers as cpn')
            .whereRaw('cpn.tenant = c.tenant')
            .andWhereRaw('cpn.contact_name_id = c.contact_name_id')
            .andWhere(function matchPhone(this: any) {
              this.whereILike('cpn.phone_number', `%${params.query}%`);
              if (normalizedDigits) {
                this.orWhere('cpn.normalized_phone_number', 'like', `%${normalizedDigits}%`);
              }
            });
        });
    })
    .select('c.contact_name_id', 'c.client_id', 'c.full_name', 'c.email', 'c.role', 'comp.client_name')
    .orderBy('c.full_name', 'asc')
    .limit(params.limit);

  return rows as TeamsContactRecord[];
}

export async function getTeamsTimeEntryById(
  entryId: string,
  context: ServiceContext
): Promise<TeamsTimeEntryRecord | null> {
  const { knex } = await createTenantKnex(context.tenant);
  const entry = await knex('time_entries')
    .where({ tenant: context.tenant, entry_id: entryId })
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
  const billableDuration = Math.max(
    0,
    Math.round((new Date(params.endTime).getTime() - new Date(params.startTime).getTime()) / 60000)
  );
  const entryId = randomUUID();

  let projectId: string | null = null;
  if (params.workItemType === 'project_task') {
    const task = await knex('project_tasks')
      .where({ tenant: params.tenantId, task_id: params.workItemId })
      .select('project_id')
      .first();
    projectId = (task as { project_id?: string | null } | undefined)?.project_id ?? null;
  }

  await knex('time_entries').insert({
    tenant: params.tenantId,
    entry_id: entryId,
    user_id: params.actorUserId,
    start_time: params.startTime,
    end_time: params.endTime,
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
  const approval = await knex('time_sheets')
    .where({ tenant: context.tenant, id: approvalId })
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
    await trx('time_sheets')
      .where({ tenant: params.tenantId, id: params.approvalId })
      .update({
        approval_status: 'APPROVED',
        approved_at: new Date(),
        approved_by: params.actorUserId,
        approval_notes: params.approvalNotes,
        updated_at: new Date(),
      });

    await trx('time_entries')
      .where({ tenant: params.tenantId, time_sheet_id: params.approvalId })
      .update({
        approval_status: 'APPROVED',
        approved_at: new Date(),
        approved_by: params.actorUserId,
        updated_at: new Date(),
      });

    if (params.approvalNotes) {
      await trx('time_sheet_comments').insert({
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
    await trx('time_sheets')
      .where({ tenant: params.tenantId, id: params.approvalId })
      .update({
        approval_status: 'CHANGES_REQUESTED',
        change_reason: params.changeReason,
        detailed_feedback: params.detailedFeedback,
        updated_at: new Date(),
      });

    await trx('time_sheet_comments').insert({
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
  const canReadAll = await hasPermission(params.user, 'timesheet', 'read_all', knex);
  const normalizedQuery = params.query?.trim();

  let query = knex('time_sheets')
    .join('users', function joinUsers() {
      this.on('time_sheets.user_id', '=', 'users.user_id').andOn('time_sheets.tenant', '=', 'users.tenant');
    })
    .join('time_periods', function joinPeriods() {
      this.on('time_sheets.period_id', '=', 'time_periods.period_id').andOn('time_sheets.tenant', '=', 'time_periods.tenant');
    })
    .where('time_sheets.tenant', params.tenantId)
    .whereIn('time_sheets.approval_status', ['SUBMITTED', 'CHANGES_REQUESTED'])
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
    const reportsToEnabled = await isFeatureFlagEnabled('teams-v2', {
      userId: params.user.user_id,
      tenantId: params.tenantId,
    });

    const reportsToUserIds = reportsToEnabled
      ? await User.getReportsToSubordinateIds(knex, params.user.user_id)
      : [];

    query = query
      .where((builder: any) => {
        builder.whereExists(function managerScope(this: any) {
          this.select(1)
            .from('team_members')
            .join('teams', function joinTeams(this: any) {
              this.on('team_members.team_id', '=', 'teams.team_id').andOn('team_members.tenant', '=', 'teams.tenant');
            })
            .where('team_members.user_id', knex.ref('users.user_id'))
            .andWhere('teams.manager_id', params.user.user_id)
            .andWhere('teams.tenant', params.tenantId);
        });

        if (reportsToEnabled && reportsToUserIds.length > 0) {
          builder.orWhereIn('users.user_id', reportsToUserIds);
        }
      })
      .distinct();
  }

  return (await query) as TeamsPendingApprovalRecord[];
}
