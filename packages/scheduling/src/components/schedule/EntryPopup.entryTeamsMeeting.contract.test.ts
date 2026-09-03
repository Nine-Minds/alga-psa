import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('EntryPopup entry-attached Teams meetings', () => {
  const source = fs.readFileSync(path.resolve(__dirname, './EntryPopup.tsx'), 'utf-8');
  const scheduleActionsSource = fs.readFileSync(
    path.resolve(__dirname, '../../actions/scheduleActions.ts'),
    'utf-8',
  );

  it('offers create/join for concrete entries and explains why recurring entries are excluded', () => {
    // The editor loads the entry-linked meeting only for concrete entries and
    // creates one through the existing-entry mode of scheduleTeamsMeeting.
    expect(source).toContain('getScheduleEntryTeamsMeeting(event.entry_id)');
    expect(source).toContain("!event.is_recurring && !event.entry_id.includes('_')");
    expect(source).toContain('scheduleTeamsMeeting({ scheduleEntryId: event.entry_id })');

    expect(source).toContain('id="create-teams-meeting-button"');
    expect(source).toContain('id="join-entry-teams-meeting-button"');
    expect(source).toContain("t('entryPopup.teamsMeeting.recurringUnsupported'");

    // Deleting an entry with an attached meeting warns that the meeting dies with it.
    expect(source).toContain("(appointmentRequestData?.online_meeting_url || entryTeamsMeeting)");
  });

  it('keeps entry-linked meetings following the entry lifecycle', () => {
    // Reschedule: entry-linked meetings are synced alongside appointment ones.
    expect(scheduleActionsSource).toContain('syncTeamsMeetingForRescheduledEntryLink');
    expect(scheduleActionsSource).toContain(".where({ schedule_entry_id: updatedEntry.entry_id })");

    // Delete: entry-linked meetings are cancelled and retracted from Graph.
    expect(scheduleActionsSource).toContain(".where({ schedule_entry_id: masterEntryId })");
    expect(scheduleActionsSource).toContain(".whereNull('appointment_request_id')");
  });
});
