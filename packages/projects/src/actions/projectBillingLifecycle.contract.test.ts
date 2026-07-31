import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const actionsSource = readFileSync(path.resolve(__dirname, 'projectActions.ts'), 'utf8');
const scheduleMigrationSource = readFileSync(
  path.resolve(__dirname, '../../../../server/migrations/20260715090001_create_project_billing_schedule_entries.cjs'),
  'utf8',
);

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = actionsSource.indexOf(startMarker);
  const end = actionsSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return actionsSource.slice(start, end);
}

describe('project billing lifecycle action contracts', () => {
  it('T008: phase completion stamps completed_at and flips only linked pending phase entries to ready', () => {
    const section = sectionBetween('export const markPhaseComplete', 'export const reopenPhase');

    expect(section).toContain("if (!await hasPermission(user, 'project', 'update', knex))");
    expect(section).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(section).toContain(".whereNull('completed_at')");
    expect(section).toContain('.update({ completed_at: completedAt, updated_at: completedAt })');
    expect(section).toContain("tenantScopedTable(trx, 'project_billing_schedule_entries', tenant)");
    expect(section).toContain('phase_id: phaseId');
    expect(section).toContain("trigger_type: 'phase'");
    expect(section).toContain("status: 'pending'");
    expect(section).toContain("status: 'ready'");
    expect(section).toContain('ready_at: completedAt');
  });

  it('T008: reopening clears completed_at and reverts ready, but not approved, entries', () => {
    const section = sectionBetween('export const reopenPhase', 'export const deletePhase');

    expect(section).toContain("if (!await hasPermission(user, 'project', 'update', knex))");
    expect(section).toContain('.update({ completed_at: null, updated_at: reopenedAt })');
    expect(section).toContain('phase_id: phaseId');
    expect(section).toContain("trigger_type: 'phase'");
    expect(section).toContain("status: 'ready'");
    expect(section).toContain("status: 'pending'");
    expect(section).toContain('ready_at: null');
    expect(section).not.toContain("status: 'approved'");
  });

  it('T010: phase deletion preserves schedule entries by nulling only phase_id', () => {
    const section = sectionBetween('export const deletePhase', 'export const getProjectTaskStatuses');

    expect(section).toContain('await ProjectModel.deletePhase(trx, tenant, phaseId);');
    expect(scheduleMigrationSource).toContain("constraint: 'project_billing_schedule_entries_phase_fk'");
    expect(scheduleMigrationSource).toContain("settable: 'phase_id'");
    expect(scheduleMigrationSource).toContain('ON DELETE SET NULL (${settable})');
  });

  it('T025: closing a project cancels only uninvoiced entries and exposes deposit reconciliation', () => {
    const helper = sectionBetween('async function closeProjectBillingSchedule', 'export const updateProject');
    const action = sectionBetween('export const updateProject', 'export const deleteProject');

    expect(helper).toContain("'entry.status': 'invoiced'");
    expect(helper).toContain(".whereIn('status', ['pending', 'ready', 'approved'])");
    expect(helper).toContain(".update({ status: 'canceled', updated_at: canceledAt })");
    expect(helper).toContain('invoiced_deposits');
    expect(helper).toContain('invoiced_milestones');
    expect(helper).toContain('> Number(totals?.invoiced_milestones ?? 0)');
    expect(action).toContain('beforeProject.is_closed !== true && project.is_closed === true');
    expect(action).toContain('await closeProjectBillingSchedule(trx, tenant, projectId)');
    expect(action).toContain('deposit_reconciliation_needed: depositReconciliationNeeded');
  });

  it('T027: phase completion and reopen require project update, not billing permissions', () => {
    const complete = sectionBetween('export const markPhaseComplete', 'export const reopenPhase');
    const reopen = sectionBetween('export const reopenPhase', 'export const deletePhase');

    for (const section of [complete, reopen]) {
      expect(section).toContain("hasPermission(user, 'project', 'update', knex)");
      expect(section).not.toContain("hasPermission(user, 'billing'");
      expect(section).not.toContain("hasPermission(user, 'invoice'");
    }
  });
});
