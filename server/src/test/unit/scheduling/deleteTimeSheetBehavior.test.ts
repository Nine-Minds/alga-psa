import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('deleteTimeSheets behavior (static)', () => {
  const actionSrc = readRepoFile('packages/scheduling/src/actions/timeSheetOperations.ts');

  it('exposes a bulk-capable deleteTimeSheets action returning per-id results', () => {
    expect(actionSrc).toContain('export const deleteTimeSheets');
    expect(actionSrc).toMatch(/deletedIds:\s*string\[\]/);
    expect(actionSrc).toMatch(/failed:\s*Array<\{\s*timeSheetId:\s*string;\s*message:\s*string\s*\}>/);
  });

  it('authorizes the caller via delegation before removing', () => {
    expect(actionSrc).toMatch(/deleteTimeSheets[\s\S]*assertCanActOnBehalf/);
  });

  it('only removes empty drafts (DRAFT/CHANGES_REQUESTED with no entries)', () => {
    expect(actionSrc).toContain("sheet.approval_status !== 'DRAFT'");
    expect(actionSrc).toContain("sheet.approval_status !== 'CHANGES_REQUESTED'");
    expect(actionSrc).toContain('Only draft time sheets can be removed');
    expect(actionSrc).toMatch(/time_entries[\s\S]*Time sheet still has time entries/);
  });

  it('exposes the timesheet id, entry count, and period-wide timesheet count to gate removal in the UI', () => {
    expect(actionSrc).toContain("'ts.id as time_sheet_id'");
    expect(actionSrc).toMatch(/entryCount:\s*parseNumericValue/);
    expect(actionSrc).toContain("'psc.period_sheet_count'");
    expect(actionSrc).toMatch(/periodTimesheetCount:\s*parseNumericValue/);
  });
});

describe('deleteTimePeriods behavior (static)', () => {
  const actionSrc = readRepoFile('packages/scheduling/src/actions/timePeriodsActions.ts');

  it('exposes a bulk-capable deleteTimePeriods action returning per-id results', () => {
    expect(actionSrc).toContain('export const deleteTimePeriods');
    expect(actionSrc).toMatch(/deletedIds:\s*string\[\]/);
    expect(actionSrc).toMatch(/failed:\s*Array<\{\s*periodId:\s*string;\s*message:\s*string\s*\}>/);
  });

  it('restricts period removal to team managers (tenant-wide deletion)', () => {
    expect(actionSrc).toMatch(/manager_id:\s*user\.user_id/);
    expect(actionSrc).toContain('Only managers can remove time periods');
  });

  it('only removes truly-unused, non-current periods', () => {
    expect(actionSrc).toMatch(/isEditable/);
    expect(actionSrc).toContain('Cannot remove a period that has timesheets');
    expect(actionSrc).toContain('Cannot remove the current period');
  });
});

describe('TimePeriodList removal gating (static)', () => {
  const componentSrc = readRepoFile(
    'packages/scheduling/src/components/time-management/time-entry/TimePeriodList.tsx',
  );

  it('removes an empty draft timesheet only when it is DRAFT/CHANGES_REQUESTED with no entries', () => {
    expect(componentSrc).toContain('getRowRemoval');
    expect(componentSrc).toContain('userHasEmptyDraft');
    expect(componentSrc).toMatch(/entryCount\s*\?\?\s*1\)\s*===\s*0/);
    expect(componentSrc).toMatch(/DELETABLE_STATUSES[\s\S]*'DRAFT'[\s\S]*'CHANGES_REQUESTED'/);
  });

  it('clears an empty row in one action: removes the draft and, when the period is then unused, the period too', () => {
    // Composite removal: a single row can yield both a timesheet delete and a period delete.
    expect(componentSrc).toContain('deleteTimeSheetId');
    expect(componentSrc).toMatch(/deletePeriod\s*=\s*canRemovePeriods/);
    expect(componentSrc).toContain('sheetsLeftAfter');
  });

  it('offers period removal only to managers, for unused non-current periods', () => {
    expect(componentSrc).toContain('canManagePeriods');
    expect(componentSrc).toMatch(/sheetsLeftAfter\s*<=\s*0/);
    expect(componentSrc).toMatch(/!isCurrentPeriod\(record\.start_date, record\.end_date\)/);
  });

  it('drives removal from selection + floating bulk bar (no per-row delete button)', () => {
    expect(componentSrc).toContain('BulkActionBar');
    expect(componentSrc).toContain('time-period-select-');
    expect(componentSrc).toContain('ConfirmationDialog');
    // The inline per-row delete was removed as it duplicated the bulk bar.
    expect(componentSrc).not.toContain('remove-time-row-');
  });
});
