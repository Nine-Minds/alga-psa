import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const timePeriodSource = readFileSync(resolve(__dirname, '../models/timePeriod.ts'), 'utf8');
const timePeriodSettingsSource = readFileSync(resolve(__dirname, './time-period-settings-actions/timePeriodSettingsActions.ts'), 'utf8');
const projectTaskLookupSource = readFileSync(resolve(__dirname, './projectTaskLookupActions.ts'), 'utf8');
const capacityThresholdSource = readFileSync(resolve(__dirname, '../lib/capacityThresholdWorkflowEvents.ts'), 'utf8');

describe('scheduling tenant-scoped query contract', () => {
  it('uses tenantDb roots for time period models and settings actions', () => {
    expect(timePeriodSource).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(timePeriodSource).toContain("tenantScopedTable<DbTimePeriod>(knexOrTrx, 'time_periods', tenant)");
    expect(timePeriodSource).toContain("tenantScopedTable(knexOrTrx, 'time_sheets', tenant)");
    expect(timePeriodSettingsSource).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db'");
    expect(timePeriodSettingsSource).toContain("tenantScopedTable<ITimePeriodSettings>(trx, 'time_period_settings', tenant)");
    expect(timePeriodSettingsSource).toContain("tenantScopedTable<ITimePeriodSettings>(db, 'time_period_settings', settings.tenant)");
  });

  it('uses tenantDb roots and joins for scheduling project task lookups', () => {
    expect(projectTaskLookupSource).toContain("tenantScopedTable(trx, 'project_tasks as pt', tenant)");
    expect(projectTaskLookupSource).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(projectTaskLookupSource).toContain("tenantFacade.tenantJoin(taskQuery, 'project_phases as pp'");
    expect(projectTaskLookupSource).toContain("tenantFacade.tenantJoin(taskQuery, 'projects as p'");
    expect(projectTaskLookupSource).toContain("tenantFacade.tenantJoin(taskQuery, 'project_status_mappings as psm'");
    expect(projectTaskLookupSource).toContain("tenantFacade.tenantJoin(taskQuery, 'users as u'");
    expect(projectTaskLookupSource).not.toContain("'pt.tenant': tenant");
  });

  it('uses tenantDb roots and tenant joins in capacity threshold workflow helpers', () => {
    expect(capacityThresholdSource).toContain("tenantScopedTable(db, 'team_members', tenant)");
    expect(capacityThresholdSource).toContain("tenantScopedTable(db, 'team_members as tm', tenant)");
    expect(capacityThresholdSource).toContain("tenantScopedTable(db, 'schedule_entry_assignees as sea', tenant)");
    expect(capacityThresholdSource).toContain("tenantDb(db, tenant).tenantJoin(capacityQuery, 'users as u'");
    expect(capacityThresholdSource).toContain("facade.tenantJoin(bookedQuery, 'schedule_entries as se'");
    expect(capacityThresholdSource).toContain("facade.tenantJoin(bookedQuery, 'team_members as tm'");
    expect(capacityThresholdSource).toContain(".leftJoin('resources as r'");
  });
});
