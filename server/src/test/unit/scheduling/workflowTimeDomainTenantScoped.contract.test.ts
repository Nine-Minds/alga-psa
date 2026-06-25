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
});
