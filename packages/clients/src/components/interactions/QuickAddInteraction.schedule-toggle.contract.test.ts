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
    // Reopening the dialog hands the switch back to the start-time rule.
    const resetBlock = source.slice(
      source.indexOf('setHasTouchedScheduleAssignees(false);'),
      source.indexOf('getCurrentUserPermissions()'),
    );
    expect(resetBlock).toContain('setHasTouchedScheduleToggle(false);');
  });

  it('only promises a calendar entry when one will actually be created', () => {
    const source = readSource();

    expect(source).toContain('{willCreateScheduleEntry && (');
    const helpIndex = source.indexOf("t('interactions.quickAdd.schedule.addHelp'");
    const gateIndex = source.indexOf('{willCreateScheduleEntry && (');
    expect(helpIndex).toBeGreaterThan(gateIndex);
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

  it('offers an owner picker on every create path, not just standalone', () => {
    const source = readSource();

    expect(source).toContain("t('interactions.quickAdd.assignedTo.label'");
    expect(source).toContain('onValueChange={handleAssignedUserChange}');
    // The owner picker sits in the create-mode block, outside the isStandaloneCreate gate.
    const createBlock = source.slice(source.indexOf('{/* Status and owner for non-edit mode'));
    const ownerPickerIndex = createBlock.indexOf('<UserPicker');
    expect(ownerPickerIndex).toBeGreaterThan(-1);
    expect(createBlock.slice(0, ownerPickerIndex)).not.toContain('isStandaloneCreate');
  });

  it('loads the internal users once per dialog, for every create path', () => {
    const source = readSource();

    expect(source).toContain('const usersList = isEditMode');
    expect(source).toContain("await getAllUsersBasicAsync(false, 'internal');");
    // The Teams attendee load must not repeat the user query the dialog already ran.
    expect(source.match(/getAllUsersBasicAsync\(false, 'internal'\)/g)).toHaveLength(1);
    expect(source).toContain('const contactsList = await getAllContacts();');
  });

  it('keeps the interaction owner and the schedule assignees in step until overridden', () => {
    const source = readSource();

    expect(source).toContain('const handleAssignedUserChange = (userId: string) => {');
    expect(source).toContain('if (canAssignScheduleToOthers && !hasTouchedScheduleAssignees) {');
    expect(source).toContain('setScheduleAssignedUserIds(userId ? [userId] : []);');
    expect(source).toContain('const handleScheduleAssigneesChange = (values: string[]) => {');
    expect(source).toContain('if (!hasTouchedAssignedUser) {');
    expect(source).toContain("setSelectedUserId(values.length === 1 ? values[0] : (session?.user?.id || ''));");
    expect(source).toContain('user_id: selectedUserId || session.user.id,');
  });

  it('carries the owner and the assignees across the Teams cross-feature seam', () => {
    expect(readSource()).toContain('interactionUserId: interactionData.user_id,');
    expect(readCrossFeatureContract()).toContain('interactionUserId?: string;');
    expect(readCrossFeatureContract()).toContain('scheduleAssignedUserIds?: string[];');
    expect(readMspProvider()).toContain('interactionUserId: input.interactionUserId,');
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
