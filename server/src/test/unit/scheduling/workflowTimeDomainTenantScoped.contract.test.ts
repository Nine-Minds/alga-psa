import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

const repoRoot = path.resolve(__dirname, '../../../../..');
const source = readFileSync(
  path.join(repoRoot, 'shared/workflow/runtime/actions/businessOperations/timeDomain.ts'),
  'utf8'
);
const metadataSource = readFileSync(
  path.join(repoRoot, 'packages/db/src/lib/tenantTableMetadata.ts'),
  'utf8'
);

const timeDomainTenantTables = [
  'bucket_usage',
  'client_contracts',
  'task_resources',
  'ticket_resources',
  'time_entries',
  'time_entry_change_requests',
  'time_sheet_comments',
  'time_sheets',
];

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('workflow time domain tenant-scoped query contract', () => {
  it('uses structural tenant scoping for actor authorization and work-item context roots', () => {
    const managerSection = sectionBetween('async function isManagerOfSubject', 'async function hasAssignedNotSelfApproverBundleRuleForWorkflowTime');
    const approvalRuleSection = sectionBetween('async function hasAssignedNotSelfApproverBundleRuleForWorkflowTime', 'async function assertCanActOnBehalfForWorkflowTime');
    const scopeEntriesSection = sectionBetween('async function scopeFindEntriesInputForActor', 'async function scopeFindTimeSheetsInputForActor');
    const workItemSection = sectionBetween('async function getWorkItemClientContext', 'function resolveDeterministicContractLineSelection');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).toContain('function tenantJoin(');
    expect(source).not.toContain('createTenantScopedQuery');

    expect(managerSection).toContain("tenantScopedTable(trx, 'teams', tenantId)");
    expect(managerSection).toContain("tenantJoin(trx, tenantId, teamManagerQuery, 'team_members'");
    expect(managerSection).toContain("tenantScopedTable(trx, 'users', tenantId)");
    expect(managerSection).not.toContain("'teams.tenant': tenantId");
    expect(managerSection).not.toContain('.where({ tenant: tenantId, user_id: subjectUserId, reports_to: actorUserId })');

    expect(approvalRuleSection).toContain("tenantScopedTable(trx, 'user_roles', tenantId)");
    expect(approvalRuleSection).toContain("tenantScopedTable(trx, 'team_members', tenantId)");
    expect(approvalRuleSection).toContain("tenantScopedTable(trx, 'authorization_bundle_assignments as a', tenantId)");
    expect(approvalRuleSection).toContain("tenantJoin(trx, tenantId, ruleQuery, 'authorization_bundles as b'");
    expect(approvalRuleSection).toContain("tenantJoin(trx, tenantId, ruleQuery, 'authorization_bundle_rules as r'");
    expect(approvalRuleSection).not.toContain(".where('a.tenant', tenantId)");
    expect(approvalRuleSection).not.toContain('.where({ tenant: tenantId, user_id: actorUserId })');

    expect(scopeEntriesSection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(scopeEntriesSection).toContain("tenantScopedTable(trx, 'time_sheets', tenantId)");
    expect(scopeEntriesSection).not.toContain('.where({ tenant: tenantId })');
    expect(scopeEntriesSection).not.toContain('.where({ tenant: tenantId, id: input.time_sheet_id })');

    expect(workItemSection).toContain("tenantScopedTable(trx, 'tickets', tenantId)");
    expect(workItemSection).toContain("tenantScopedTable(trx, 'project_tasks as pt', tenantId)");
    expect(workItemSection).toContain("tenantJoin(trx, tenantId, taskQuery, 'project_phases as pp'");
    expect(workItemSection).toContain("tenantJoin(trx, tenantId, taskQuery, 'projects as p'");
    expect(workItemSection).toContain("tenantScopedTable(trx, 'projects', tenantId)");
    expect(workItemSection).toContain("tenantScopedTable(trx, 'interactions', tenantId)");
    expect(workItemSection).toContain("tenantScopedTable(trx, 'schedule_entries', tenantId)");
    expect(workItemSection).not.toContain('.where({ tenant: tenantId, ticket_id: link.id })');
    expect(workItemSection).not.toContain(".where({ 'pt.tenant': tenantId, 'pt.task_id': link.id })");
    expect(workItemSection).not.toContain('.where({ tenant: tenantId, project_id: link.id })');
    expect(workItemSection).not.toContain('.where({ tenant: tenantId, interaction_id: link.id })');
    expect(workItemSection).not.toContain('.where({ tenant: tenantId, entry_id: link.id })');
  });

  it('uses structural tenant scoping for usage, timesheet resolution, and entry side-effect roots', () => {
    const bucketPeriodSection = sectionBetween('async function resolveBucketUsagePeriod', 'async function applyBucketUsageDeltaForEntry');
    const usageSection = sectionBetween('async function applyBucketUsageDeltaForEntry', 'async function resolveOrCreateTimeSheet');
    const timesheetSection = sectionBetween('async function resolveOrCreateTimeSheet', 'async function applyTicketAssignmentSideEffects');
    const ticketSideEffectSection = sectionBetween('async function applyTicketAssignmentSideEffects', 'async function recalculateProjectTaskActualMinutes');
    const taskRecalcSection = sectionBetween('async function recalculateProjectTaskActualMinutes', 'async function applyProjectTaskAssignmentSideEffects');
    const taskSideEffectSection = sectionBetween('async function applyProjectTaskAssignmentSideEffects', 'export async function createWorkflowTimeEntry');
    const createEntryValidationSection = sectionBetween('export async function createWorkflowTimeEntry', '  const startDate = ensureValidDate');

    expect(bucketPeriodSection).toContain("tenantScopedTable(trx, 'client_billing_cycles', tenantId)");
    expect(bucketPeriodSection).toContain("tenantScopedTable(trx, 'client_contract_lines as ccl', tenantId)");
    expect(bucketPeriodSection).toContain("tenantScopedTable(trx, 'bucket_usage', tenantId)");
    expect(bucketPeriodSection).not.toMatch(/\.where\(\{\s*tenant:\s*tenantId/);
    expect(bucketPeriodSection).not.toContain("'ccl.tenant': tenantId");

    expect(usageSection).toContain("tenantScopedTable(trx, 'contract_line_service_configuration as cfg', tenantId)");
    expect(usageSection).toContain("tenantScopedTable(trx, 'bucket_usage', tenantId)");
    expect(usageSection).not.toContain("'cfg.tenant': tenantId");
    expect(usageSection).not.toContain('.where({ tenant: tenantId, usage_id: usageId })');

    expect(timesheetSection).toContain("tenantScopedTable(trx, 'time_sheets as ts', tenantId)");
    expect(timesheetSection).toContain("tenantScopedTable(trx, 'time_periods', tenantId)");
    expect(timesheetSection).toContain("tenantScopedTable(trx, 'time_sheets', tenantId)");
    expect(timesheetSection).not.toContain(".where({ 'ts.tenant': tenantId, 'ts.id': providedTimeSheetId })");
    expect(timesheetSection).not.toContain('.where({ tenant: tenantId, is_closed: false })');
    expect(timesheetSection).not.toContain('.where({ tenant: tenantId, user_id: userId, period_id: period.period_id })');

    expect(ticketSideEffectSection).toContain("tenantScopedTable(trx, 'ticket_resources', tenantId)");
    expect(ticketSideEffectSection).toContain("tenantScopedTable(trx, 'tickets', tenantId)");
    expect(ticketSideEffectSection).not.toContain('.where({ tenant: tenantId, ticket_id: ticketId })');

    expect(taskRecalcSection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(taskRecalcSection).toContain("tenantScopedTable(trx, 'project_tasks', tenantId)");
    expect(taskRecalcSection).not.toContain(".where({ tenant: tenantId, work_item_type: 'project_task', work_item_id: taskId })");
    expect(taskRecalcSection).not.toContain('.where({ tenant: tenantId, task_id: taskId })');

    expect(taskSideEffectSection).toContain("tenantScopedTable(trx, 'project_tasks', tenantId)");
    expect(taskSideEffectSection).toContain("tenantScopedTable(trx, 'task_resources', tenantId)");
    expect(taskSideEffectSection).not.toContain('.where({ tenant: tenantId, task_id: taskId })');

    expect(createEntryValidationSection).toContain("tenantScopedTable(trx, 'users', tenantId)");
    expect(createEntryValidationSection).toContain("tenantScopedTable(trx, 'service_catalog', tenantId)");
    expect(createEntryValidationSection).not.toContain('.where({ tenant: tenantId, user_id: input.user_id })');
    expect(createEntryValidationSection).not.toContain('.where({ tenant: tenantId, service_id: input.service_id })');
  });

  it('uses structural tenant scoping for update, delete, and get entry roots', () => {
    const updateEntrySection = sectionBetween('export async function updateWorkflowTimeEntry', 'export async function deleteWorkflowTimeEntry');
    const deleteEntrySection = sectionBetween('export async function deleteWorkflowTimeEntry', 'export async function getWorkflowTimeEntry');
    const getEntrySection = sectionBetween('export async function getWorkflowTimeEntry', 'function applyFindEntriesFilters');

    expect(updateEntrySection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(updateEntrySection).toContain("tenantScopedTable(trx, 'service_catalog', tenantId)");
    expect(updateEntrySection).not.toContain('.where({ tenant: tenantId, entry_id: input.entry_id })');
    expect(updateEntrySection).not.toContain('.where({ tenant: tenantId, service_id: resolvedServiceId })');

    expect(deleteEntrySection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(deleteEntrySection).not.toContain('.where({ tenant: tenantId, entry_id: entryId })');

    expect(getEntrySection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(getEntrySection).not.toContain('.where({ tenant: tenantId, entry_id: entryId })');
  });

  it('uses structural tenant scoping for find-entry, approval, and time-sheet summary roots', () => {
    const filtersSection = sectionBetween('function applyFindEntriesFilters', 'export async function findWorkflowTimeEntries');
    const findEntriesSection = sectionBetween('export async function findWorkflowTimeEntries', 'export async function setWorkflowTimeEntryApprovalStatus');
    const approvalSection = sectionBetween('export async function setWorkflowTimeEntryApprovalStatus', 'export async function requestWorkflowTimeEntryChanges');
    const summarySection = sectionBetween('async function summarizeTimeSheet', 'export async function findOrCreateWorkflowTimeSheet');

    expect(filtersSection).not.toContain("query.where('te.tenant', tenantId)");
    expect(filtersSection).toContain("const db = tenantDb(trx, tenantId)");
    expect(filtersSection).toContain("db.tenantJoin(taskClientQuery, 'project_phases as pp'");
    expect(filtersSection).not.toContain("whereRaw('t.tenant = te.tenant')");
    expect(filtersSection).not.toContain("whereRaw('pt.tenant = te.tenant')");
    expect(filtersSection).not.toContain("whereRaw('p.tenant = te.tenant')");
    expect(filtersSection).not.toContain("whereRaw('i.tenant = te.tenant')");
    expect(findEntriesSection).toContain("tenantScopedTable(trx, 'time_entries as te', tenantId)");
    expect(findEntriesSection).toContain('applyFindEntriesFilters(listQuery, trx, tenantId, input)');
    expect(findEntriesSection).toContain('applyFindEntriesFilters(aggregateQuery, trx, tenantId, input)');
    expect(findEntriesSection).not.toContain("trx('time_entries as te')");
    expect(findEntriesSection).not.toContain('applyFindEntriesFilters(listQuery, tenantId, input)');
    expect(source).not.toContain('applyFindEntriesFilters(query, tenantId,');

    expect(approvalSection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(approvalSection).toContain("tenantScopedTable(trx, 'time_sheets', tenantId)");
    expect(approvalSection).toContain("tenantScopedTable(trx, 'time_entry_change_requests', tenantId)");
    expect(approvalSection).not.toContain('.where({ tenant: tenantId, entry_id: entryId })');
    expect(approvalSection).not.toContain('.where({ tenant: tenantId, id: existing.time_sheet_id })');

    expect(summarySection).toContain("tenantScopedTable(trx, 'time_sheets as ts', tenantId)");
    expect(summarySection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(summarySection).toContain("tenantScopedTable(trx, 'time_sheet_comments', tenantId)");
    expect(summarySection).not.toContain("'ts.tenant': tenantId");
    expect(summarySection).not.toContain('.where({ tenant: tenantId, time_sheet_id: timeSheetId })');
  });

  it('uses structural tenant scoping for time-sheet creation, listing, and mutation roots', () => {
    const createSheetSection = sectionBetween('export async function findOrCreateWorkflowTimeSheet', 'export async function getWorkflowTimeSheet');
    const getSheetSection = sectionBetween('export async function getWorkflowTimeSheet', 'export async function findWorkflowTimeSheets');
    const findSheetsSection = sectionBetween('export async function findWorkflowTimeSheets', 'export async function submitWorkflowTimeSheet');
    const submitSection = sectionBetween('export async function submitWorkflowTimeSheet', 'export async function approveWorkflowTimeSheet');
    const approveSection = sectionBetween('export async function approveWorkflowTimeSheet', 'export async function requestWorkflowTimeSheetChanges');
    const requestChangesSection = sectionBetween('export async function requestWorkflowTimeSheetChanges', 'export async function reverseWorkflowTimeSheetApproval');
    const reverseSection = sectionBetween('export async function reverseWorkflowTimeSheetApproval', 'export async function addWorkflowTimeSheetComment');
    const commentSection = sectionBetween('export async function addWorkflowTimeSheetComment', 'async function resolveClientIdForEntryRow');

    expect(createSheetSection).toContain("tenantScopedTable(trx, 'time_periods', tenantId)");
    expect(createSheetSection).toContain("tenantScopedTable(trx, 'time_sheets', tenantId)");
    expect(createSheetSection).not.toContain('.where({ tenant: tenantId, is_closed: false })');

    expect(getSheetSection).toContain("tenantScopedTable(trx, 'time_sheet_comments', tenantId)");
    expect(getSheetSection).not.toContain('.where({\n      tenant: tenantId,\n      time_sheet_id: timeSheetId,');

    expect(findSheetsSection).toContain("tenantScopedTable(trx, 'time_sheets as ts', tenantId)");
    expect(findSheetsSection).not.toContain(".where('ts.tenant', tenantId)");

    for (const section of [submitSection, approveSection, requestChangesSection, reverseSection]) {
      expect(section).toContain("tenantScopedTable(trx, 'time_sheets', tenantId)");
      expect(section).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
      expect(section).not.toContain('.where({ tenant: tenantId, id: timeSheetId })');
      expect(section).not.toContain('.where({ tenant: tenantId, time_sheet_id: timeSheetId })');
    }

    expect(commentSection).toContain("tenantScopedTable(trx, 'time_sheets', tenantId)");
    expect(commentSection).not.toContain('.where({ tenant: tenantId, id: timeSheetId })');
    expect(source).not.toMatch(/\.where\(\{\s*tenant:\s*tenantId/);
    expect(source).not.toContain(".where('ts.tenant', tenantId)");
    expect(source).not.toContain("query.where('te.tenant', tenantId)");
  });

  it('keeps time-domain tenant data roots behind the facade', () => {
    for (const table of timeDomainTenantTables) {
      expect(source).not.toContain(`trx('${table}')`);
      expect(metadataSource).toContain(`${table}: { scope: 'tenant' }`);
    }
  });
});
