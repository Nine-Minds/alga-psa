import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const component = fs.readFileSync(path.resolve(__dirname, '../src/components/schedule/AvailabilitySettings.tsx'), 'utf8');
const schedulePage = fs.readFileSync(path.resolve(__dirname, '../src/components/schedule/SchedulePage.tsx'), 'utf8');

describe('AvailabilitySettings UX contracts', () => {
  it('bootstraps independent reads in parallel and memoizes both selectors', () => {
    expect(component).toMatch(/Promise\.all\(\[\s*getAvailabilitySettingsAccess\(\),\s*getServices\(\)/);
    expect(component).toContain('const userOptions: SelectOption[] = useMemo');
    expect(component).toContain('const teamOptions: SelectOption[] = useMemo');
    // CustomSelect renders its own associated label from the label prop; the
    // outer <Label> duplicates were removed so the caption shows once.
    expect(component).toMatch(/id="team-selector"\s+label=\{t\('availabilitySettings\.common\.teamSelect\.label'/);
    expect(component).toMatch(/id="user-hours-selector"\s+label=\{t\('availabilitySettings\.userHours\.userSelect\.label'/);
  });

  it('guards stale reads and renders explicit loading and error states', () => {
    expect(component).toContain('const requestId = ++userHoursRequestRef.current');
    expect(component).toContain('requestId !== userHoursRequestRef.current');
    expect(component).toContain('isUserHoursLoading ?');
    expect(component).toContain('userHoursError ?');
  });

  it('confirms the authoritative week before the exact success toast', () => {
    const saveSection = component.slice(component.indexOf('const handleSaveUserHours'), component.indexOf('const handleSaveServiceRules'));
    expect(saveSection).toContain('saveUserAvailabilityWeek');
    expect(saveSection).toContain('result.data.length !== 7');
    expect(saveSection.indexOf("setUserHours(authoritative.hours)")).toBeLessThan(saveSection.indexOf("toast.success"));
    expect(saveSection).not.toContain('setUserHours(buildDefaultUserHours())');
    expect(component).toContain('disabled={isSavingUserHours || !canManageUserHours}');
  });

  it('persists dialog and editor context per browser tab', () => {
    expect(component).toContain('readAvailabilityContext()');
    expect(component).toContain('writeAvailabilityContext({ isOpen, activeTab, selectedTeamId, selectedUserId })');
    expect(schedulePage).toContain('writeAvailabilityContext({ isOpen: true })');
    expect(schedulePage).toContain('readAvailabilityContext()?.isOpen');
  });

  it('states team scope, saved-versus-draft status, and non-inheritance', () => {
    expect(component).toContain('booking hours are user-wide across teams');
    expect(component).toContain('Unsaved Monday–Friday 9:00 AM–5:00 PM template');
    expect(component).toContain('Saved booking hours');
    expect(component).toContain('They do not inherit from the separate work schedule');
  });
});
