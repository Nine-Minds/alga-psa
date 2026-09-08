import { expect, it } from 'vitest';
import { CO_MANAGED_PORTABLE_RESTORE_SECTIONS, CO_MANAGED_PORTABLE_RESTORE_GLOBALS,
  prepareCoManagedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import type { PortableRecords } from '../../../../../packages/co-managed/src/portableRecordValidation';
import { preparePortableWorkflowAuditHistory } from '../../../../../packages/co-managed/src/portableWorkflowHistory';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sourceTenant = id(1), destinationTenant = id(2), foreignTenant = id(3);
function fixture() {
  const sections = Object.fromEntries(Object.entries(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).map(([section, columns]) => [section, Object.fromEntries(Object.keys(columns).map(table => [table, []]))])) as Record<string, PortableRecords>;
  const add = (table: string, values: Record<string, unknown>) => {
    const section = Object.keys(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).find(section => Object.hasOwn(CO_MANAGED_PORTABLE_RESTORE_SECTIONS[section as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS], table))!;
    const columns = (CO_MANAGED_PORTABLE_RESTORE_SECTIONS[section as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS] as Record<string, readonly string[]>)[table];
    const row = Object.assign(Object.fromEntries(columns.map(column => [column, null])), values); sections[section][table].push(row); return row;
  };
  add('tenants', { client_name: 'Customer' }); add('users', { user_id: id(10), username: 'customer-tech', user_type: 'internal', is_inactive: false });
  add('teams', { team_id: id(11), manager_id: id(10) }); add('team_members', { team_id: id(11), user_id: id(10) });
  add('clients', { client_id: id(12), client_name: 'Own customer' });
  add('boards', { board_id: id(20), default_assigned_to: id(10) }); add('statuses', { status_id: id(21), board_id: id(20) });
  add('tickets', { ticket_id: id(22), board_id: id(20), status_id: id(21), client_id: id(12), entered_by: id(10) });
  add('comment_threads', { thread_id: id(23), ticket_id: id(22), root_comment_id: id(24), created_by: id(10) });
  add('comments', { comment_id: id(24), ticket_id: id(22), thread_id: id(23), user_id: id(10), note: { literal: id(22) }, publish_state: 'scheduled' });
  add('projects', { project_id: id(25), client_id: id(12), status: id(21) });
  add('project_phases', { phase_id: id(26), project_id: id(25), status: 'in_progress' });
  add('project_tasks', { task_id: id(27), phase_id: id(26), status_id: id(21) });
  add('comment_threads', { thread_id: id(28), project_task_id: id(27), root_comment_id: id(29), created_by: id(10) });
  add('project_task_comments', { task_comment_id: id(29), task_id: id(27), thread_id: id(28), user_id: id(10) });
  add('collaboration_actor_references', { actor_reference_id: id(30), actor_tenant: foreignTenant, actor_user_id: id(10), display_name: 'MSP author' });
  add('handoff_history', { operation_id: id(31), ticket_id: id(22), actor_tenant: foreignTenant, actor_user_id: id(10) });
  add('documents', { document_id: id(40), user_id: id(10), source_template_id: 'standard-invoice-by-location' });
  add('document_associations', { association_id: id(41), document_id: id(40), entity_type: 'tenant', entity_id: sourceTenant });
  add('document_folders', { folder_id: id(42), entity_type: 'project_task', entity_id: id(27) });
  add('document_template_assignments', { assignment_id: id(43), scope_type: 'client', scope_id: id(12) });
  add('assets', { asset_id: id(50), asset_type: 'workstation', client_id: id(12) }); add('workstation_assets', { asset_id: id(50), os_type: 'Linux' });
  add('asset_associations', { asset_id: id(50), entity_type: 'user', entity_id: id(10) });
  add('asset_maintenance_schedules', { schedule_id: id(51), asset_id: id(50), is_active: true });
  add('time_periods', { period_id: id(60) }); add('time_sheets', { id: id(61), user_id: id(10), period_id: id(60) });
  add('time_entries', { entry_id: id(62), user_id: id(10), time_sheet_id: id(61), work_item_id: id(22), work_item_type: 'ticket' });
  add('schedule_entries', { entry_id: id(63), work_item_id: id(27), work_item_type: 'project_task' });
  add('schedule_entry_assignees', { entry_id: id(63), user_id: id(10) }); add('user_work_schedules', { user_id: id(10), day_of_week: 1 });
  add('workflow_definitions', { workflow_id: id(70), draft_version: 1, is_paused: false, draft_definition: { literal: id(22) } });
  add('workflow_form_definitions', { form_id: 'local-form', created_by: id(10) });
  add('workflow_form_schemas', { schema_id: 'local-schema', form_id: 'local-form' });
  add('workflow_task_definitions', { task_definition_id: id(71), form_type: 'tenant', form_id: 'local-form' });
  add('interaction_types', { type_id: id(80), created_by: id(10) });
  add('interactions', { interaction_id: id(81), type_id: id(80), ticket_id: id(22), user_id: id(10) });
  add('availability_settings', { availability_setting_id: id(82), config_json: { approver_user_ids: [id(10)], approver_team_ids: [id(11)], default_approver_id: id(10), auto_approval_enabled: true } });
  add('online_meetings', { meeting_id: id(83), interaction_id: id(81), status: 'scheduled' });
  const globalColumns = ['standard_status_id', 'type_id', 'type_id', 'id'];
  const destinationCatalogMappings = Object.fromEntries(CO_MANAGED_PORTABLE_RESTORE_GLOBALS.map((table, i) => {
    add(table, { [globalColumns[i]]: id(90 + i) }); return [table, { [id(90 + i)]: id(900 + i) }];
  })) as any;
  return { sourceTenant, destinationTenant, sections, destinationCatalogMappings, add };
}
function prepare(f = fixture()) { let n = 1000; const { add: _add, ...request } = f; return prepareCoManagedPortableWorkspaceRecords(request, { allocateUuid: () => id(n++) }); }
it('maps all seven section schemas and their explicit scalar, composite, conditional and nested dependencies', () => {
  const r = prepare(); const rows = r.records;
  expect(Object.keys(rows)).toHaveLength(115);
  expect(rows.team_members[0]).toMatchObject({ team_id: rows.teams[0].team_id, user_id: rows.users[0].user_id });
  expect(rows.workstation_assets[0].asset_id).toBe(rows.assets[0].asset_id);
  expect(rows.asset_associations[0].entity_id).toBe(rows.users[0].user_id);
  expect(rows.document_associations[0].entity_id).toBe(destinationTenant);
  expect(rows.document_folders[0].entity_id).toBe(rows.project_tasks[0].task_id);
  expect(rows.document_template_assignments[0].scope_id).toBe(rows.clients[0].client_id);
  expect(rows.time_entries[0].work_item_id).toBe(rows.tickets[0].ticket_id);
  expect(rows.schedule_entries[0].work_item_id).toBe(rows.project_tasks[0].task_id);
  expect(rows.comment_threads[0].root_comment_id).toBe(rows.comments[0].comment_id);
  expect(rows.comment_threads[1].root_comment_id).toBe(rows.project_task_comments[0].task_comment_id);
  expect(rows.interactions[0].type_id).toBe(rows.interaction_types[0].type_id);
  expect(rows.workflow_form_definitions[0].created_by).toBe(rows.users[0].user_id);
  expect(rows.availability_settings[0].config_json).toMatchObject({ approver_user_ids: [rows.users[0].user_id], approver_team_ids: [rows.teams[0].team_id], default_approver_id: rows.users[0].user_id });
});
it('restores task responses and attributed history as inert audit records without execution or claim state', () => {
  const f = fixture();
  f.add('workflow_tasks', { task_id: id(72), tenant_task_definition_id: id(71), task_definition_type: 'tenant', title: 'Customer review',
    status: 'completed', created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-02T10:00:00.000Z',
    created_by: id(10), created_by_name: 'Customer Author', completed_by: id(999), completed_by_name: 'Former technician', response_data: { accepted: true, comment: 'Preserved response' } });
  f.add('workflow_task_history', { history_id: id(73), task_id: id(72), action: 'complete', from_status: 'pending', to_status: 'completed',
    user_id: id(999), user_name: 'Former technician', timestamp: '2026-09-02T10:00:00.000Z', details: { formData: { accepted: true } } });
  const r = prepare(f), rows = preparePortableWorkflowAuditHistory(r);
  expect(rows).toHaveLength(2);
  expect(r.records.workflow_tasks[0].tenant_task_definition_id).toBe(r.records.workflow_task_definitions[0].task_definition_id);
  expect(rows[0]).toMatchObject({ tenant: destinationTenant, record_id: r.records.workflow_tasks[0].task_id, user_id: null,
    details: { source_tenant: sourceTenant, source_task_id: id(72), actor_identity: 'source_tenant', execution_state: 'not_restored',
      portable_workflow_task: { completed_by: id(999), completed_by_name: 'Former technician', response_data: { accepted: true, comment: 'Preserved response' } } } });
  expect(rows[1]).toMatchObject({ record_id: rows[0].record_id, user_id: null,
    details: { portable_workflow_task_activity: { task_id: rows[0].record_id, user_id: id(999), details: { formData: { accepted: true } } } } });
  expect(JSON.stringify(rows)).not.toMatch(/execution_id|context_data|claimed_by|event_id/);
  expect(r.records.workflow_definitions[0].is_paused).toBe(true);
});
it('accepts exact earlier workflow packages without inventing task history or weakening the new table shape', () => {
  const f = fixture(); delete f.sections.workflows.workflow_tasks; delete f.sections.workflows.workflow_task_history;
  expect(prepare(f).records.workflow_tasks).toEqual([]);
  f.sections.workflows.workflow_tasks = [];
  expect(() => prepare(f)).toThrow('Incomplete portable record tables');
});
it('restores records inactive or paused without rewriting authored literals, template provenance or foreign actor identity', () => {
  const f = fixture(), original = structuredClone(f.sections), r = prepare(f), rows = r.records;
  expect(f.sections).toEqual(original);
  expect(rows.users[0].is_inactive).toBe(true); expect(rows.workflow_definitions[0].is_paused).toBe(true);
  expect(rows.asset_maintenance_schedules[0].is_active).toBe(false); expect(rows.comments[0].publish_state).toBe('canceled');
  expect(rows.online_meetings[0].status).toBe('cancelled');
  expect(rows.documents[0].source_template_id).toBe('standard-invoice-by-location');
  expect(rows.comments[0].note).toEqual({ literal: id(22) }); expect(rows.workflow_definitions[0].draft_definition).toEqual({ literal: id(22) });
  expect(rows.handoff_history[0]).toMatchObject({ actor_tenant: foreignTenant, actor_user_id: id(10) });
  expect(rows.collaboration_actor_references[0]).toMatchObject({ actor_tenant: foreignTenant, actor_user_id: id(10) });
  expect(r.insertionDefaults.time_entries).toEqual({ billing_mode: 'operational', billable_duration: 0, service_id: null, invoiced: false });
  expect(r.restorePolicy).toMatchObject({ authentication: 'reauthorize', sponsorship: 'none', destinationActivation: 'manual' });
});
it('requires explicit global semantic mappings and supports the system interaction type union', () => {
  const f = fixture(); f.sections.engagement.interactions[0].type_id = id(92);
  const r = prepare(f); expect(r.records.interactions[0].type_id).toBe(id(902));
  for (const global of CO_MANAGED_PORTABLE_RESTORE_GLOBALS) {
    const g = fixture(); delete g.destinationCatalogMappings[global]; expect(() => prepare(g)).toThrow('global catalog');
  }
  const g = fixture(); g.destinationCatalogMappings.standard_statuses = {}; expect(() => prepare(g)).toThrow('incomplete');
});
it('rejects ambiguous interaction unions and broken conditional references before returning a destination graph', () => {
  const f = fixture(); f.sections.engagement.system_interaction_types[0].type_id = id(80);
  f.destinationCatalogMappings.system_interaction_types = { [id(80)]: id(902) };
  expect(() => prepare(f)).toThrow('ambiguous');
  const g = fixture(); g.sections.documents.document_associations[0].entity_id = foreignTenant;
  expect(() => prepare(g)).toThrow('foreign');
  const h = fixture(); (h.sections.engagement.availability_settings[0].config_json as any).approver_user_ids = [id(999)];
  expect(() => prepare(h)).toThrow('reference is missing');
});
it('remaps existing local history and retains deleted-local actor pairs without creating replacement users', () => {
  const f = fixture(); f.sections.work.handoff_history[0].actor_tenant = sourceTenant;
  f.sections.core.collaboration_actor_references[0].actor_tenant = sourceTenant;
  f.sections.core.collaboration_actor_references[0].actor_user_id = id(999);
  const r = prepare(f);
  expect(r.records.handoff_history[0]).toMatchObject({ actor_tenant: destinationTenant, actor_user_id: r.records.users[0].user_id });
  expect(r.records.collaboration_actor_references[0]).toMatchObject({ actor_tenant: sourceTenant, actor_user_id: id(999) });
  expect(r.records.users).toHaveLength(1);
});
it('preserves system form identities and terminal meeting history while treating global records as references only', () => {
  const f = fixture(); f.sections.workflows.workflow_task_definitions[0].form_type = 'system';
  f.sections.workflows.workflow_task_definitions[0].form_id = 'builtin-approval';
  f.sections.workflows.workflow_form_definitions[0].created_by = 'system';
  f.sections.engagement.online_meetings[0].status = 'recording_ready';
  const r = prepare(f);
  expect(r.records.workflow_task_definitions[0].form_id).toBe('builtin-approval');
  expect(r.records.workflow_form_definitions[0].created_by).toBe('system');
  expect(r.records.online_meetings[0].status).toBe('recording_ready');
  expect(r.globalCatalogTables).toEqual(CO_MANAGED_PORTABLE_RESTORE_GLOBALS);
  expect(r.restorePolicy.globalDefinitions).toBe('existing_destination_only');
});
it('keeps case-sensitive text form IDs even when their spelling resembles a UUID', () => {
  const f = fixture(), form = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  f.sections.workflows.workflow_form_definitions[0].form_id = form;
  f.sections.workflows.workflow_form_schemas[0].form_id = form;
  f.sections.workflows.workflow_task_definitions[0].form_id = form;
  const r = prepare(f);
  expect(r.records.workflow_form_definitions[0].form_id).toBe(form);
  expect(r.records.workflow_task_definitions[0].form_id).toBe(form);
});
