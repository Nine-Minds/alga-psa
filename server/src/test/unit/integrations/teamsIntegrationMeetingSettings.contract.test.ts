import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Teams integration meeting settings contracts', () => {
  it('T072: resolves and persists the organizer object id when Teams settings are saved', () => {
    const actionsSource = readRepoFile('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts');
    const contractsSource = readRepoFile('ee/packages/microsoft-teams/src/lib/teams/teamsContracts.ts');

    expect(contractsSource).toContain('defaultMeetingOrganizerUpn?: string | null');
    expect(contractsSource).toContain('defaultMeetingOrganizerObjectId: string | null');
    expect(actionsSource).toContain('resolveOrganizerObjectId');
    expect(actionsSource).toContain('fetchMicrosoftGraphAppToken');
    expect(actionsSource).toContain("https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizerUpn)}");
    expect(actionsSource).toContain('const objectId = normalizeNullableString(payload.id)');
    expect(actionsSource).toContain('default_meeting_organizer_upn: defaultMeetingOrganizerUpn');
    expect(actionsSource).toContain('default_meeting_organizer_object_id: defaultMeetingOrganizerObjectId');
  });

  it('T073: persists recording download and client-portal visibility toggles from Teams settings', () => {
    const actionsSource = readRepoFile('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts');
    const uiSource = readRepoFile('packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx');

    expect(actionsSource).toContain('download_recordings: downloadRecordings');
    expect(actionsSource).toContain('expose_recordings_in_portal: exposeRecordingsInPortal');
    expect(uiSource).toContain('id="teams-download-recordings"');
    expect(uiSource).toContain('id="teams-expose-recordings-in-portal"');
    expect(uiSource).toContain('integrations.teams.settings.meetings.downloadRecordings.label');
    expect(uiSource).toContain('integrations.teams.settings.meetings.exposeRecordingsInPortal.label');
  });

  it('persists the send-meeting-invites toggle with default-on semantics from Teams settings', () => {
    const actionsSource = readRepoFile('ee/packages/microsoft-teams/src/lib/actions/integrations/teamsActions.ts');
    const uiSource = readRepoFile('packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx');

    expect(actionsSource).toContain('sendMeetingInvites: row.send_meeting_invites !== false');
    expect(actionsSource).toContain('send_meeting_invites: sendMeetingInvites');
    expect(uiSource).toContain('id="send-meeting-invites-switch"');
    expect(uiSource).toContain('integrations.teams.settings.meetings.sendMeetingInvites.label');
    expect(uiSource).toContain('integrations.teams.settings.meetings.sendMeetingInvites.description');
  });

  it('T072: keeps organizer controls out of Availability Settings after the UI move', () => {
    const availabilitySource = readRepoFile('packages/scheduling/src/components/schedule/AvailabilitySettings.tsx');

    expect(availabilitySource).not.toContain('default-meeting-organizer-upn');
    expect(availabilitySource).not.toContain('save-teams-meeting-organizer');
    expect(availabilitySource).not.toContain('verify-teams-meeting-organizer');
    expect(availabilitySource).not.toContain('getTeamsMeetingsTabState');
  });
});
