/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('schedule entry Teams meeting wiring contract', () => {
  it('T050: EntryPopup offers Teams generation for new schedule entries and ScheduleCalendar routes save to scheduleTeamsMeeting', () => {
    const entryPopupSource = read('./EntryPopup.tsx');
    const calendarSource = read('./ScheduleCalendar.tsx');

    expect(entryPopupSource).toContain('getTeamsMeetingCapability');
    expect(entryPopupSource).toContain('id="generate-teams-meeting-schedule-entry-popup"');
    expect(entryPopupSource).toContain('generate_teams_meeting: shouldGenerateTeamsForEntry');
    expect(entryPopupSource).toContain('teams_meeting_client_id: shouldGenerateTeamsForEntry ? selectedWorkItemClientId : null');
    expect(entryPopupSource).toContain('Select a client-backed work item before generating a Teams meeting');

    expect(calendarSource).toContain('scheduleTeamsMeeting');
    expect(calendarSource).toContain('if (generate_teams_meeting)');
    expect(calendarSource).toContain('createScheduleEntry: true');
    expect(calendarSource).toContain('client_id: teams_meeting_client_id ?? null');
  });
});
