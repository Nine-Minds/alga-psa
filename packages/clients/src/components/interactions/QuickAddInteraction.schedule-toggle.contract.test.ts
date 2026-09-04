/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './QuickAddInteraction.tsx'), 'utf8');
}

function readCrossFeatureContract(): string {
  return fs.readFileSync(path.resolve(__dirname, '../../context/ClientCrossFeatureContext.tsx'), 'utf8');
}

function readMspProvider(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../../../msp-composition/src/clients/MspClientCrossFeatureProvider.tsx'),
    'utf8',
  );
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

  it('passes the flag and the assignees to addInteraction and to the Teams path', () => {
    const source = readSource();

    expect(source).toContain(
      '{ createScheduleEntry: canAddToSchedule && addToSchedule, scheduleAssignedUserIds },',
    );
    expect(source).toContain('createScheduleEntry: true,');
    expect(source).toContain('scheduleAssignedUserIds,\n        });');
  });

  it('only offers the assignee picker to users who may update other schedules', () => {
    const source = readSource();

    expect(source).toContain('getCurrentUserPermissions()');
    expect(source).toContain("setCanAssignScheduleToOthers(permissions.includes('user_schedule:update'))");
    expect(source).toContain(
      'const willCreateScheduleEntry = teamsMeetingWillSchedule || (canAddToSchedule && addToSchedule);',
    );
    expect(source).toContain(
      'const canPickScheduleAssignees = !isEditMode && willCreateScheduleEntry && canAssignScheduleToOthers;',
    );
    expect(source).toContain('{canPickScheduleAssignees && (');
    expect(source).toContain('<MultiUserPicker');
    expect(source).toContain("t('interactions.quickAdd.schedule.assigneesLabel'");
    expect(source).toContain("t('interactions.quickAdd.schedule.addHelpOthers'");
  });

  it('loads the internal users only once the assignee picker is on screen', () => {
    const source = readSource();

    expect(source).toContain(
      'if (!canPickScheduleAssignees || hasLoadedScheduleUserOptions || hasLoadedAttendeeOptions) {',
    );
    expect(source).toContain("await getAllUsersBasicAsync(false, 'internal')");
  });

  it('keeps the interaction owner in step with a single chosen assignee', () => {
    const source = readSource();

    expect(source).toContain('const handleScheduleAssigneesChange = (values: string[]) => {');
    expect(source).toContain("setSelectedUserId(values.length === 1 ? values[0] : (session?.user?.id || ''));");
    expect(source).toContain('user_id: selectedUserId || session.user.id,');
  });

  it('carries the assignees across the Teams cross-feature seam', () => {
    expect(readCrossFeatureContract()).toContain('scheduleAssignedUserIds?: string[];');
    expect(readMspProvider()).toContain('scheduleEntry: input.scheduleAssignedUserIds?.length');
    expect(readMspProvider()).toContain('{ assignedUserIds: input.scheduleAssignedUserIds }');
  });

  it('pre-selects an open status when the tenant default is closed or missing', () => {
    const source = readSource();

    expect(source).toContain('statusList.find(s => s.is_default && !s.is_closed)');
    expect(source).toContain('statusList.filter(s => !s.is_closed)');
    expect(source).toContain('.sort((a, b) => (a.order_number || 0) - (b.order_number || 0))[0]');
  });
});
