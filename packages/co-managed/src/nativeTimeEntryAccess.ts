import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import { productTimeEntryMode, type IWorkItem } from '@alga-psa/types';
import { assertCoManagedOperationalWrite, getCoManagedOperationalState } from '@alga-psa/licensing';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { hasCoManagedLocalPermission } from './localPermission';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export function isNativeTimeFieldHidden(redactions: readonly string[], fields: readonly string[]) {
  return isCoManagedReadFieldHidden(redactions, fields.flatMap(field => [field, `values.${field}`, `time_entries.${field}`, `native_time_tracking_sessions.${field}`]));
}

interface TimeSaveInput {
  entry_id?: string | null; user_id: string; time_sheet_id?: string;
  work_item_id: string; work_item_type: string; approval_status?: string;
}
export interface CoManagedNativeTimeAccess { workItem: IWorkItem; subjectUserId: string; redactedTimeFields: readonly string[]; assertCurrent(): Promise<void> }

/** Retain actual local work, entry ownership and editable sheets through the
 * native save. Source locators are hints until their parent and entry locks
 * confirm them. No trust or MSP actor can substitute for this home credential. */
export async function admitCoManagedNativeTimeSave(trx: Knex.Transaction, inputActor: CoManagedAuthenticatedActor,
  input: TimeSaveInput): Promise<CoManagedNativeTimeAccess> {
  return admitNativeTimeAccess(trx, inputActor, input, 'save');
}

/** The timer owner loads and locks its clock/receipt before calling this source
 * boundary. A clock ID is not looked up as an already completed time entry. */
export async function admitCoManagedNativeTimeSource(trx: Knex.Transaction, inputActor: CoManagedAuthenticatedActor,
  input: TimeSaveInput, action: 'read' | 'create' | 'update'): Promise<CoManagedNativeTimeAccess> {
  return admitNativeTimeAccess(trx, inputActor, input, action);
}

async function admitNativeTimeAccess(trx: Knex.Transaction, inputActor: CoManagedAuthenticatedActor,
  input: TimeSaveInput, action: 'save' | 'read' | 'create' | 'update'): Promise<CoManagedNativeTimeAccess> {
  const reading = action === 'read', sourceOnly = action !== 'save';
  const actor = snapshotCoManagedAuthenticatedActor(inputActor), owner = tenantDb(trx, actor.tenant);
  input = { ...input };
  if (!trx.isTransaction || (input.entry_id && !isCoManagedUuid(input.entry_id)) ||
    (input.time_sheet_id && !isCoManagedUuid(input.time_sheet_id))) throw new CoManagedSharedWorkError();
  if (reading) await getCoManagedOperationalState(trx, actor.tenant); else await assertCoManagedOperationalWrite(trx, actor.tenant);
  const workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
  if (!workspace || !productTimeEntryMode(workspace.product_code) || workspace.suspended_at) throw new CoManagedSharedWorkError();
  const { subject, assertCurrent: assertAuthenticationCurrent } = await lockCoManagedLocalAuthentication(trx, actor);
  const hint = !sourceOnly && input.entry_id ? await owner.table('time_entries').where('entry_id', input.entry_id).first() : null;
  if (!sourceOnly && input.entry_id && !hint) throw new CoManagedSharedWorkError();
  const subjectUserId = hint?.user_id || input.user_id || actor.userId;
  if (!isCoManagedUuid(subjectUserId) || !await owner.table('users').where({ user_id: subjectUserId, user_type: 'internal', is_inactive: false }).forShare().first('user_id')) throw new CoManagedSharedWorkError();

  if (subjectUserId !== actor.userId) {
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_sheet', 'approve', true)) throw new CoManagedSharedWorkError();
    const readAll = await hasCoManagedLocalPermission(trx, actor, 'time_sheet', 'read_all', true);
    if (!readAll) {
      const teams = owner.table('team_members as member').where('member.user_id', subjectUserId);
      owner.tenantJoin(teams, 'teams as team', 'member.team_id', 'team.team_id');
      const managedTeam = await teams.where('team.manager_id', actor.userId).forShare().first('team.team_id');
      let managed = !!managedTeam, next: string | null = subjectUserId;
      const visited = new Set<string>();
      while (!managed && next && !visited.has(next)) {
        visited.add(next);
        const manager: { reports_to: string | null } | undefined = await owner.table('users').where('user_id', next).forShare().first('reports_to');
        next = manager?.reports_to ?? null; managed = next === actor.userId;
      }
      if (!managed) throw new CoManagedSharedWorkError();
      subject.managedUserIds = [...new Set([...(subject.managedUserIds ?? []), subjectUserId])];
    }
    await authorizeCoManagedLocalRecord(trx, actor, subject, 'time_entry', 'read', { ownerUserId: subjectUserId, assignedUserIds: [subjectUserId] });
  }

  // Both sheets remain editable when moving an entry. Caller-supplied DRAFT
  // must never reopen submitted or approved work.
  const sheetIds = [...new Set([hint?.time_sheet_id, input.time_sheet_id].filter(Boolean))].sort();
  for (const id of sheetIds) {
    const sheet = await owner.table('time_sheets').where('id', id).forUpdate().first('user_id', 'approval_status', 'period_id');
    if (!sheet || sheet.user_id !== subjectUserId || (!reading && !['DRAFT', 'CHANGES_REQUESTED'].includes(sheet.approval_status))) throw new CoManagedSharedWorkError();
    if (!await owner.table('time_periods').where('period_id', sheet.period_id).forShare().first('period_id')) throw new CoManagedSharedWorkError();
  }
  if (!reading && input.approval_status && input.approval_status !== 'DRAFT' && input.approval_status !== 'CHANGES_REQUESTED') throw new CoManagedSharedWorkError();
  if (hint && (hint.invoiced || !['DRAFT', 'CHANGES_REQUESTED'].includes(hint.approval_status))) throw new CoManagedSharedWorkError();

  const sources = [input, ...(hint ? [hint] : [])];
  const taskIds = [...new Set(sources.filter(source => source.work_item_type === 'project_task').map(source => source.work_item_id))].sort();
  if (!taskIds.every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const locate = owner.table('project_tasks as task').whereIn('task.task_id', taskIds);
  owner.tenantJoin(locate, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  const hints = await locate.select('task.task_id', 'phase.project_id');
  if (hints.length !== taskIds.length) throw new CoManagedSharedWorkError();
  const projectIds = [...new Set(hints.map(row => row.project_id))].sort();
  const projectQuery = owner.table('projects').whereIn('project_id', projectIds).orderBy('project_id');
  if (reading) projectQuery.forShare(); else projectQuery.forUpdate();
  const projects = await projectQuery.select('project_id', 'client_id', 'assigned_to', 'project_name');
  const taskQuery = owner.table('project_tasks as task').whereIn('task.task_id', taskIds).orderBy('task.task_id');
  owner.tenantJoin(taskQuery, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
  if (reading) taskQuery.forShare('task', 'phase'); else taskQuery.forUpdate('task', 'phase');
  const tasks = await taskQuery.select('task.task_id', 'task.task_name', 'task.description', 'phase.project_id', 'phase.phase_name');
  if (tasks.length !== taskIds.length || tasks.some(task => hints.find(row => row.task_id === task.task_id)?.project_id !== task.project_id)) throw new CoManagedSharedWorkError();

  const projections = new Map<string, IWorkItem>(), redactedTimeFields: string[] = [];
  const uniqueSources = [...new Map(sources.map(source => [`${source.work_item_type}:${source.work_item_id}`, source])).entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [key, source] of uniqueSources) {
    let resourceType: string | null = null, record: AuthorizationRecord = {}, fields: string[] = [];
    const workItem: IWorkItem & { project_name?: string; phase_name?: string; ticket_number?: string } = { work_item_id: source.work_item_id, type: source.work_item_type, name: '', description: '', is_billable: false };
    if (source.work_item_type === 'project_task') {
      const task = tasks.find(row => row.task_id === source.work_item_id), project = projects.find(row => row.project_id === task?.project_id);
      if (!task || !project) throw new CoManagedSharedWorkError();
      resourceType = 'project'; record = { id: project.project_id, clientId: project.client_id, assignedUserIds: project.assigned_to ? [project.assigned_to] : [], teamIds: [] };
      Object.assign(workItem, { name: task.task_name, description: task.description ?? '', project_name: project.project_name, phase_name: task.phase_name });
    } else if (source.work_item_type === 'ticket') {
      if (!isCoManagedUuid(source.work_item_id)) throw new CoManagedSharedWorkError();
      const ticket = await owner.table('tickets').where('ticket_id', source.work_item_id).forShare().first('ticket_id', 'title', 'url', 'ticket_number', 'client_id', 'board_id', 'assigned_to', 'entered_by');
      if (!ticket) throw new CoManagedSharedWorkError();
      resourceType = 'ticket'; record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by, assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: [] };
      Object.assign(workItem, { name: ticket.title, description: ticket.url ?? '', ticket_number: ticket.ticket_number });
    } else if (source.work_item_type === 'ad_hoc') {
      if (!isCoManagedUuid(source.work_item_id)) throw new CoManagedSharedWorkError();
      const schedule = await owner.table('schedule_entries').where({ entry_id: source.work_item_id, work_item_type: 'ad_hoc' }).forShare().first('title');
      if (!schedule) throw new CoManagedSharedWorkError();
      const assignments = await owner.table('schedule_entry_assignees').where('entry_id', source.work_item_id).forShare().select('user_id');
      if (!assignments.some(row => row.user_id === actor.userId) && !await hasCoManagedLocalPermission(trx, actor, 'user_schedule', 'update', true)) throw new CoManagedSharedWorkError();
      resourceType = 'user_schedule'; record = { id: source.work_item_id, assignedUserIds: assignments.map(row => row.user_id) }; workItem.name = schedule.title;
    } else if (source.work_item_type === 'interaction') {
      if (!isCoManagedUuid(source.work_item_id)) throw new CoManagedSharedWorkError();
      const interaction = await owner.table('interactions').where('interaction_id', source.work_item_id).forShare().first('title', 'client_id', 'user_id');
      if (!interaction) throw new CoManagedSharedWorkError();
      resourceType = 'interaction'; record = { id: source.work_item_id, clientId: interaction.client_id, ownerUserId: interaction.user_id }; workItem.name = interaction.title;
    } else if (source.work_item_type === 'non_billable_category') {
      if (source.work_item_id !== '__non_billable__' && source.work_item_id != null && source.work_item_id !== '') throw new CoManagedSharedWorkError();
      workItem.work_item_id = '__non_billable__';
    } else throw new CoManagedSharedWorkError();
    if (resourceType) fields = (await authorizeCoManagedLocalRecord(trx, actor, subject, resourceType, 'read', record)).redactedFields;
    const sourceId = source.work_item_type === 'project_task' ? 'task_id' : source.work_item_type === 'ticket' ? 'ticket_id' : source.work_item_type === 'interaction' ? 'interaction_id' : 'entry_id';
    if (isCoManagedReadFieldHidden(fields, ['time_entries', 'work_item_id', sourceId, `values.${sourceId}`])) throw new CoManagedSharedWorkError();
    const timeRecord = { ...record, id: input.entry_id || undefined, ownerUserId: subjectUserId, assignedUserIds: [subjectUserId] };
    const timeAction = sourceOnly ? action : input.entry_id ? 'update' : 'create';
    const timePolicy = await authorizeCoManagedLocalRecord(trx, actor, subject, 'time_entry', timeAction, timeRecord);
    const timeFields = [...timePolicy.redactedFields];
    // These mutations return a full entry. Its current read policy must also
    // admit that response, including stored notes omitted from a partial edit.
    if (!reading) timeFields.push(...(await authorizeCoManagedLocalRecord(trx, actor, subject, 'time_entry', 'read', timeRecord)).redactedFields);
    redactedTimeFields.push(...timeFields);
    if (!reading && isNativeTimeFieldHidden(timeFields, ['notes', 'start_time', 'end_time', 'work_item_id', 'work_item_type', 'time_sheet_id', 'user_id'])) throw new CoManagedSharedWorkError();
    const hidden = (names: string[]) => isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `values.${name}`, `project_tasks.${name}`, `projects.${name}`, `project_phases.${name}`, `tickets.${name}`]));
    if (hidden(['name', 'title', 'task_name'])) workItem.name = '';
    if (hidden(['description', 'url'])) workItem.description = '';
    if (hidden(['project_name', 'projectName', 'project'])) delete workItem.project_name;
    if (hidden(['phase_name', 'phaseName', 'phase'])) delete workItem.phase_name;
    if (hidden(['ticket_number'])) delete workItem.ticket_number;
    projections.set(key, workItem);
  }
  if (hint) {
    const current = await owner.table('time_entries').where('entry_id', input.entry_id).forUpdate().first();
    if (!current || ['work_item_id', 'work_item_type', 'user_id', 'time_sheet_id', 'approval_status', 'billing_mode', 'invoiced'].some(field => current[field] !== hint[field])) throw new CoManagedSharedWorkError();
  }
  const assertCurrent = async () => { await assertAuthenticationCurrent(); if (!reading) await assertCoManagedOperationalWrite(trx, actor.tenant); };
  await assertCurrent();
  return { subjectUserId, redactedTimeFields, workItem: projections.get(`${input.work_item_type}:${input.work_item_id}`)!, assertCurrent };
}
