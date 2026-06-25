import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

const repoRoot = path.resolve(__dirname, '../../../../..');
const source = readFileSync(
  path.join(repoRoot, 'shared/workflow/runtime/actions/businessOperations/timeDomain.ts'),
  'utf8'
);

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

    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');

    expect(managerSection).toContain("tenantScopedTable(trx, 'teams', tenantId)");
    expect(managerSection).toContain("tenantScopedTable(trx, 'users', tenantId)");
    expect(managerSection).not.toContain("'teams.tenant': tenantId");
    expect(managerSection).not.toContain('.where({ tenant: tenantId, user_id: subjectUserId, reports_to: actorUserId })');

    expect(approvalRuleSection).toContain("tenantScopedTable(trx, 'user_roles', tenantId)");
    expect(approvalRuleSection).toContain("tenantScopedTable(trx, 'team_members', tenantId)");
    expect(approvalRuleSection).toContain("tenantScopedTable(trx, 'authorization_bundle_assignments as a', tenantId)");
    expect(approvalRuleSection).not.toContain(".where('a.tenant', tenantId)");
    expect(approvalRuleSection).not.toContain('.where({ tenant: tenantId, user_id: actorUserId })');

    expect(scopeEntriesSection).toContain("tenantScopedTable(trx, 'time_entries', tenantId)");
    expect(scopeEntriesSection).toContain("tenantScopedTable(trx, 'time_sheets', tenantId)");
    expect(scopeEntriesSection).not.toContain('.where({ tenant: tenantId })');
    expect(scopeEntriesSection).not.toContain('.where({ tenant: tenantId, id: input.time_sheet_id })');

    expect(workItemSection).toContain("tenantScopedTable(trx, 'tickets', tenantId)");
    expect(workItemSection).toContain("tenantScopedTable(trx, 'project_tasks as pt', tenantId)");
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
    const usageSection = sectionBetween('async function applyBucketUsageDeltaForEntry', 'async function resolveOrCreateTimeSheet');
    const timesheetSection = sectionBetween('async function resolveOrCreateTimeSheet', 'async function applyTicketAssignmentSideEffects');
    const ticketSideEffectSection = sectionBetween('async function applyTicketAssignmentSideEffects', 'async function recalculateProjectTaskActualMinutes');
    const taskRecalcSection = sectionBetween('async function recalculateProjectTaskActualMinutes', 'async function applyProjectTaskAssignmentSideEffects');
    const taskSideEffectSection = sectionBetween('async function applyProjectTaskAssignmentSideEffects', 'export async function createWorkflowTimeEntry');
    const createEntryValidationSection = sectionBetween('export async function createWorkflowTimeEntry', '  const startDate = ensureValidDate');

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
});
