import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createMicrosoftProfile } from '../fixtures/microsoft-profile';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

test.use({ emulatorProviders: ['msgraph'] });

test('Teams profile recovery and calendar meeting creation preserve saved identities', async ({ page, credentials, database, emulators }, testInfo) => {
  if (process.env.E2E_EDITION !== 'enterprise' || process.env.E2E_TEAMS_DEVELOPMENT !== 'true'
    || testInfo.config.metadata.releaseValidation !== false) {
    throw new Error('Requires the explicit Teams development configuration and a development app with TEAMS_EMULATOR_MODE=true');
  }
  const actors = await createProductionBrowserActors(database, { sourceEmail: credentials.email });
  const tenant = actors.primary, scope = { tenant: tenant.tenantId };
  const clientId = randomUUID(), profileName = `Teams app ${actors.runId}`;
  const clientSecret = `synthetic-teams-${actors.runId}`;
  await emulators.seed('msgraph', 'client', { clientId, clientSecret });
  try {
    await signIn(page, { email: tenant.admin.email, password: credentials.password });
    await createMicrosoftProfile(page, { name: profileName, clientId, clientSecret, capability: 'teams' });
    const profile = await database('microsoft_profiles').where({ ...scope, client_id: clientId }).first();
    expect(profile).toBeTruthy();
    await page.goto('/msp/settings?tab=integrations&category=communication');
    await page.getByRole('button', { name: 'Microsoft Teams', exact: true }).click();
    await page.locator('#teams-profile').selectOption({ label: profileName });
    await page.locator('#teams-save-draft').click();
    await expect.poll(async () => (await database('teams_integrations').where(scope).first())?.selected_profile_id).toBe(profile.profile_id);
    const saved = await database('teams_integrations').where(scope).first();

    await emulators.arm('msgraph', 'operation-fault', {
      operation: 'token', status: 503, body: { error: 'temporarily_unavailable', error_description: 'Synthetic Teams credential outage' },
    });
    await page.locator('#teams-validate-profile').click();
    const step = page.locator('#teams-wizard-step-microsoft-profile');
    await expect(step.getByText('Microsoft profile credentials are valid.', { exact: true })).toHaveCount(0);
    await expect(step.getByRole('alert')).toBeVisible();
    await expect.poll(async () => (await emulators.requests('msgraph')).requests.some((r: any) =>
      r.method === 'POST' && r.path.endsWith('/oauth2/v2.0/token') && r.status === 503)).toBe(true);
    expect((await database('teams_integrations').where(scope).first()).selected_profile_id).toBe(saved.selected_profile_id);

    await emulators.disarm('msgraph', 'operation-fault');
    await page.locator('#teams-validate-profile').click();
    await expect(step.getByText('Microsoft profile credentials are valid.', { exact: true })).toBeVisible();
    await expect.poll(async () => (await emulators.requests('msgraph')).requests.some((r: any) =>
      r.method === 'POST' && r.path.endsWith('/oauth2/v2.0/token') && r.status === 200)).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Microsoft Teams', exact: true }).click();
    await expect(page.locator('#teams-profile')).toHaveValue(profile.profile_id);
    expect(await database('microsoft_profiles').where({ ...scope, client_id: clientId })).toHaveLength(1);
    const retained = await database('teams_integrations').where(scope).first();
    expect(retained.selected_profile_id).toBe(saved.selected_profile_id);
    expect(retained.install_status).toBe(saved.install_status);

    // Provision the already-validated integration as an installed tenant. This
    // fixture does not claim to perform the external Teams installation flow.
    await database('teams_integrations').where(scope).update({
      install_status: 'active', default_meeting_organizer_upn: 'organizer@contoso.example',
      default_meeting_organizer_object_id: randomUUID(), send_meeting_invites: true,
    });
    const title = `Teams appointment ${actors.runId}`;
    await page.goto('/msp/schedule');
    const noon = page.locator('.rbc-day-slot.rbc-today .rbc-time-slot').nth(24);
    await noon.scrollIntoViewIfNeeded();
    const bounds = await noon.boundingBox();
    if (!bounds) throw new Error('Today noon slot must be visible');
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    const newEntry = page.getByRole('dialog', { name: 'New Entry', exact: true });
    await newEntry.locator('#title').fill(title);
    await newEntry.locator('#save-entry-btn').click();
    await expect(newEntry).toBeHidden();
    const rows = await database('schedule_entries').where({ ...scope, title });
    expect(rows).toHaveLength(1);
    const entryId = rows[0].entry_id;
    const openEntry = async () => {
      await page.locator('.rbc-event').filter({ hasText: title }).first().getByText(title, { exact: true }).click();
      return page.getByRole('dialog', { name: 'Edit Entry', exact: true });
    };
    const editEntry = await openEntry();
    await editEntry.locator('#create-teams-meeting-button').click();
    await expect(editEntry.locator('#join-entry-teams-meeting-button')).toBeVisible();
    const meetingScope = { ...scope, schedule_entry_id: entryId };
    const meetings = await database('online_meetings').where(meetingScope);
    expect(meetings).toHaveLength(1);
    const meeting = meetings[0];
    expect(meeting.join_url).toContain('meetup-join');
    expect(meeting.status).toBe('scheduled');
    const vendorEvents = await emulators.state<Array<{ id: string; subject: string }>>('msgraph', 'calendar-events');
    expect(vendorEvents.filter(event => event.subject === title)).toEqual([
      expect.objectContaining({ id: meeting.provider_event_id }),
    ]);
    await editEntry.locator('#save-entry-btn').click();
    await expect(editEntry).toBeHidden();
    await page.reload();
    const reopened = await openEntry();
    await expect(reopened.locator('#join-entry-teams-meeting-button')).toBeVisible();
    await expect(reopened.locator('#create-teams-meeting-button')).toHaveCount(0);
    expect(await reopened.locator('#notes').inputValue()).toContain(meeting.join_url);
    expect(await database('online_meetings').where(meetingScope)).toHaveLength(1);
    expect((await database('schedule_entries').where({ ...scope, entry_id: entryId }).first()).notes).toContain(meeting.join_url);

  } finally {
    await emulators.disarm('msgraph', 'operation-fault');
  }
});
