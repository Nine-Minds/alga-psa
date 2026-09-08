import type { Knex } from 'knex';
import type { AuthorizationSubject } from '@alga-psa/authorization';
import { createAuthorizationKernel, BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider, resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization';
import { tenantDb, withTransaction, timePeriodCalendarDate } from '@alga-psa/db';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { retainScheduleSource } from './nativeScheduleRead';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, matchesCoManagedScopeConstraints, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';

export function isAppointmentFieldHidden(fields: readonly string[], names: string[]) {
  return isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `values.${name}`, `appointment_requests.${name}`]));
}

async function appointmentAuthority(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, preferred: string | null) {
  const owner = tenantDb(trx, actor.tenant);
  const canRead = await hasCoManagedLocalPermission(trx, actor, 'user_schedule', 'read', true);
  const canUpdate = await hasCoManagedLocalPermission(trx, actor, 'user_schedule', 'update', true);
  const full = canUpdate || await hasCoManagedLocalPermission(trx, actor, 'user', 'read', true);
  const settings = await owner.table('availability_settings').whereIn('setting_type', ['general_settings', 'user_hours']).orderBy('availability_setting_id').forShare();
  let approver = false;
  for (const setting of settings) {
    const config = typeof setting.config_json === 'string' ? JSON.parse(setting.config_json) : setting.config_json;
    if (!config || (setting.setting_type === 'user_hours' && setting.user_id !== preferred)) continue;
    // LEVERAGE: pattern appointment-approver-config — mirrors scheduling's pure legacy/multiple approver decoding without depending on the higher-level scheduling package.
    const users = Array.isArray(config.approver_user_ids) ? config.approver_user_ids.filter(Boolean) : [];
    const teams = Array.isArray(config.approver_team_ids) ? config.approver_team_ids.filter(Boolean) : [];
    if (!users.length && !teams.length && config.default_approver_id) users.push(config.default_approver_id);
    if (users.includes(actor.userId) || teams.some((id: string) => subject.teamIds?.includes(id))) approver = true;
  }
  let visible = full || approver || preferred === actor.userId;
  if (!visible && preferred) {
    const managedTeams = await owner.table('teams').where('manager_id', actor.userId).orderBy('team_id').forShare().select('team_id');
    if (managedTeams.length) visible = Boolean(await owner.table('team_members').where('user_id', preferred).whereIn('team_id', managedTeams.map(row => row.team_id)).forShare().first('user_id'));
    // Retain the actual management chain; cycles terminate without granting access.
    const visited = new Set<string>(); let userId: string | null = preferred;
    while (!visible && userId && !visited.has(userId)) {
      visited.add(userId);
      const person: any = await owner.table('users').where({ user_id: userId, user_type: 'internal', is_inactive: false }).forShare().first('reports_to');
      userId = person?.reports_to ?? null; visible = userId === actor.userId;
    }
  }
  return { canRead: (canRead || canUpdate) && visible, canUpdate: canUpdate || approver };
}

/** Shared root admission for appointment readers and explicit commands. */
export async function retainNativeAppointmentRequest(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, id: string, writing = false) {
  if (!isCoManagedUuid(id)) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, actor.tenant);
  const source = await retainScheduleSource(trx, actor, subject, { work_item_type: 'appointment_request', work_item_id: id }, writing);
  const request = await owner.table('appointment_requests').where('appointment_request_id', id).first();
  if (!request) throw new CoManagedSharedWorkError();
  const authority = await appointmentAuthority(trx, actor, subject, request.preferred_assigned_user_id);
  const record = { ...source.record, id, ownerUserId: request.preferred_assigned_user_id ?? undefined,
    assignedUserIds: request.preferred_assigned_user_id ? [request.preferred_assigned_user_id] : [] };
  const kernel = createAuthorizationKernel({ builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: input => resolveBundleNarrowingRulesForEvaluation(trx, input, { lock: true }) }),
    rbacEvaluator: async input => input.resource.action === 'read' ? authority.canRead : authority.canUpdate,
  });
  const fields = [...source.fields];
  for (const action of writing ? ['read', 'update'] : ['read']) {
    const decision = await kernel.authorizeResource({ knex: trx, subject, resource: { type: 'user_schedule', action, id }, record });
    if (!decision.allowed || !matchesCoManagedScopeConstraints(decision.scope.constraints, record)) throw new CoManagedSharedWorkError();
    fields.push(...decision.redactedFields);
  }
  if (isAppointmentFieldHidden(fields, ['tenant', 'appointment_request_id', 'status'])) throw new CoManagedSharedWorkError();
  const authorizeSchedule = async (schedule: any, assignments: string[]) => {
    const scheduleFields = [...fields];
    for (const action of writing ? ['read', 'update'] : ['read']) {
      const scheduleRecord = { ...source.record, id: schedule.entry_id, ownerUserId: assignments.length === 1 ? assignments[0] : undefined, assignedUserIds: assignments };
      const decision = await kernel.authorizeResource({ knex: trx, subject, resource: { type: 'user_schedule', action, id: schedule.entry_id }, record: scheduleRecord });
      if (!decision.allowed || !matchesCoManagedScopeConstraints(decision.scope.constraints, scheduleRecord)) throw new CoManagedSharedWorkError();
      scheduleFields.push(...decision.redactedFields);
    }
    return scheduleFields;
  };
  return { request, fields, source, authorizeSchedule };
}

/** Labels are projected under the related record's own read authority. The
 * request cannot grant access to contact PII or unrelated client/user details. */
export async function nativeAppointmentRequestView(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject,
  retained: Awaited<ReturnType<typeof retainNativeAppointmentRequest>>) {
  const { request: row, fields, source } = retained, owner = tenantDb(trx, actor.tenant);
  const hidden = (...names: string[]) => isAppointmentFieldHidden(fields, names);
  const view: any = { tenant: actor.tenant, appointment_request_id: row.appointment_request_id, status: row.status };
  const content = new Set(['description', 'declined_reason', 'requester_name', 'requester_email', 'requester_phone', 'company_name', 'online_meeting_url']);
  for (const key of ['client_id', 'contact_id', 'service_id', 'requested_date', 'requested_time', 'requested_duration', 'requester_timezone', 'preferred_assigned_user_id', 'description', 'ticket_id', 'is_authenticated', 'requester_name', 'requester_email', 'requester_phone', 'company_name', 'schedule_entry_id', 'approved_by_user_id', 'approved_at', 'declined_reason', 'online_meeting_provider', 'online_meeting_url', 'online_meeting_id', 'created_at', 'updated_at']) {
    if (hidden(key) || (source.fields.length && content.has(key))) continue;
    view[key] = key === 'requested_date' ? timePeriodCalendarDate(row[key]) : row[key];
  }
  const label = async (table: string, pk: string, id: string | null, resource: string, map: Record<string, string>, clientColumn?: string) => {
    if (!id) return;
    try {
      const related = await owner.table(table).where(pk, id).forShare().first();
      if (!related) return;
      if (clientColumn && related[clientColumn] !== row.client_id) throw new CoManagedSharedWorkError();
      const decision = await authorizeCoManagedLocalRecord(trx, actor, subject, resource, 'read', { id, clientId: resource === 'client' ? id : related.client_id, ownerUserId: resource === 'user' ? id : undefined });
      for (const [key, column] of Object.entries(map)) if (!hidden(key, `${resource}_id`) && !isCoManagedReadFieldHidden(decision.redactedFields, [column, `values.${column}`, `${table}.${column}`])) view[key] = related[column];
    } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
  };
  if (view.client_id) await label('clients', 'client_id', row.client_id, 'client', { client_company_name: 'client_name' });
  if (view.contact_id) await label('contacts', 'contact_name_id', row.contact_id, 'contact', { contact_name: 'full_name', contact_email: 'email' }, 'client_id');
  if (view.preferred_assigned_user_id) await label('users', 'user_id', row.preferred_assigned_user_id, 'user', { preferred_technician_first_name: 'first_name', preferred_technician_last_name: 'last_name' });
  if (view.approved_by_user_id) await label('users', 'user_id', row.approved_by_user_id, 'user', { approver_first_name: 'first_name', approver_last_name: 'last_name' });
  if (view.service_id && !hidden('service_name')) view.service_name = (await owner.table('service_catalog').where('service_id', row.service_id).forShare().first('service_name'))?.service_name;
  if (view.ticket_id && !source.fields.length) {
    const ticket = await owner.table('tickets').where('ticket_id', row.ticket_id).first('title', 'ticket_number');
    if (!hidden('ticket_title')) view.ticket_title = ticket?.title;
    if (!hidden('ticket_number')) view.ticket_number = ticket?.ticket_number;
  }
  return view;
}

export async function readCoManagedNativeAppointmentRequests(db: Knex, tenant: string, identify: () => Promise<CoManagedAuthenticatedActor>,
  options: { id?: string; ticketId?: string; filters?: Record<string, any> } = {}) {
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    if (options.ticketId) await retainScheduleSource(trx, actor, credential.subject, { work_item_type: 'ticket', work_item_id: options.ticketId });
    const query = owner.table('appointment_requests').orderBy('created_at', 'desc').orderBy('appointment_request_id');
    if (options.id) query.where('appointment_request_id', options.id);
    if (options.ticketId) query.where('ticket_id', options.ticketId);
    const ids = await query.select('appointment_request_id'), requests: any[] = [], filters = options.filters ?? {};
    for (const row of ids) {
      try {
        const retained = await retainNativeAppointmentRequest(trx, actor, credential.subject, row.appointment_request_id);
        const view = await nativeAppointmentRequestView(trx, actor, credential.subject, retained);
        if (options.ticketId && view.ticket_id !== options.ticketId) continue;
        if (Object.entries({ status: 'status', service_id: 'service_id', client_id: 'client_id', assigned_user_id: 'preferred_assigned_user_id', is_authenticated: 'is_authenticated' }).some(([filter, field]) => filters[filter] != null && view[field] !== filters[filter])) continue;
        if (filters.start_date && (!view.requested_date || view.requested_date < filters.start_date) || filters.end_date && (!view.requested_date || view.requested_date > filters.end_date)) continue;
        if (filters.search_query && !['service_name', 'client_company_name', 'contact_name', 'requester_name', 'description'].some(key => String(view[key] ?? '').toLowerCase().includes(String(filters.search_query).toLowerCase()))) continue;
        requests.push(view);
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError) || options.id) throw error; }
    }
    await credential.assertCurrent();
    return { handled: true as const, requests };
  });
}
