/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './QuickAddInteraction.tsx'), 'utf8');
}

describe('quick add interaction schedule toggle wiring contract', () => {
  it('offers the schedule toggle for every interaction type once a start time is set', () => {
    const source = readSource();

    expect(source).toContain('const teamsMeetingWillSchedule = createTeamsMeeting && canCreateTeamsMeeting;');
    expect(source).toContain(
      'const canAddToSchedule = !isEditMode && !!startTime && !teamsMeetingWillSchedule;',
    );
    expect(source).toContain('{canAddToSchedule && (');
    expect(source).toContain("id={`${id}-add-to-schedule-toggle`}");
    expect(source).toContain("t('interactions.quickAdd.schedule.addToggle'");
  });

  it('defaults on for future starts and off for past-dated logging', () => {
    const source = readSource();

    expect(source).toContain('if (isEditMode || hasTouchedScheduleToggle) return;');
    expect(source).toContain('setAddToSchedule(!!startTime && startTime.getTime() > Date.now() + 60000);');
    expect(source).toContain('setHasTouchedScheduleToggle(true);');
  });

  it('passes the flag to addInteraction and leaves the Teams path untouched', () => {
    const source = readSource();

    expect(source).toContain('{ createScheduleEntry: canAddToSchedule && addToSchedule },');
    expect(source).toContain('createScheduleEntry: true,');
  });

  it('pre-selects an open status when the tenant default is closed or missing', () => {
    const source = readSource();

    expect(source).toContain('statusList.find(s => s.is_default && !s.is_closed)');
    expect(source).toContain('statusList.filter(s => !s.is_closed)');
    expect(source).toContain('.sort((a, b) => (a.order_number || 0) - (b.order_number || 0))[0]');
  });
});
