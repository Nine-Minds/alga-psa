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

    // Prelinked MSP identity is a fixture; sign-in/account-linking is a separate journey.
    const microsoftTenantId = randomUUID(), microsoftUserId = randomUUID();
    const foreignMicrosoftUserId = randomUUID(), conversationId = `bot-${actors.runId}`;
    await database('microsoft_profiles').where({ ...scope, profile_id: profile.profile_id }).update({ tenant_id: microsoftTenantId });
    await database('teams_integrations').where(scope).update({ enabled_capabilities: JSON.stringify(['personal_bot']) });
    await database('user_auth_accounts').insert([
      { ...scope, user_id: tenant.admin.userId, provider: 'microsoft', provider_account_id: microsoftUserId },
      { tenant: actors.secondary.tenantId, user_id: actors.secondary.admin.userId, provider: 'microsoft', provider_account_id: foreignMicrosoftUserId },
    ]);
    const query = `Bot isolation ${actors.runId}`;
    const ownTitle = `${query} OWN`, foreignTitle = `${query} FOREIGN`;
    for (const [actor, ticketTitle] of [[tenant, ownTitle], [actors.secondary, foreignTitle]] as const) {
      await database('tickets').insert({ tenant: actor.tenantId, ticket_id: randomUUID(), title: ticketTitle,
        ticket_number: `BOT-${actors.runId.slice(0, 8)}`, client_id: actor.clients.primary.id,
        board_id: actor.ticketing.boardId, status_id: actor.ticketing.openStatusId,
        priority_id: actor.ticketing.priorityId, entered_by: actor.admin.userId,
        assigned_to: actor.admin.userId, entered_at: database.fn.now(), is_closed: false });
    }
    await emulators.seed('msgraph', 'client', { clientId: 'e2e-teams-bot', clientSecret: 'synthetic-e2e-teams-bot-secret' });
    const botInput = { targetUrl: process.env.E2E_TEAMS_BOT_TARGET_URL || 'http://server:3000/api/teams/bot/messages',
      serviceUrl: process.env.E2E_TEAMS_BOT_SERVICE_URL || 'http://algasim:4010', appId: 'e2e-teams-bot',
      tenantId: microsoftTenantId, fromAadObjectId: microsoftUserId, conversationId,
      conversationType: 'personal', text: `ticket ${query}` };
    // Compile this development route before the emulator's bounded delivery call.
    expect((await page.request.get('/api/teams/bot/messages')).status()).toBe(405);
    const sent = await emulators.seed('msgraph', 'bot-activity', botInput);
    expect(sent).toMatchObject({ delivered: true, status: 200 });
    const replies = await emulators.state<Array<{ conversationId: string }>>('msgraph', 'bot-activities');
    const ownReplies = replies.filter(reply => reply.conversationId === conversationId);
    expect(ownReplies).toHaveLength(1);
    expect(JSON.stringify(ownReplies)).toContain(ownTitle);
    expect(JSON.stringify(ownReplies)).not.toContain(foreignTitle);
    expect(await database('teams_conversation_references').where({ ...scope, conversation_id: conversationId }).first())
      .toMatchObject({ microsoft_user_id: microsoftUserId, tenant_id_aad: microsoftTenantId });
    const deniedConversation = `foreign-${conversationId}`;
    const denied = await emulators.seed('msgraph', 'bot-activity', { ...botInput,
      fromAadObjectId: foreignMicrosoftUserId, conversationId: deniedConversation });
    expect(denied).toMatchObject({ delivered: true, status: 200 });
    const deniedReplies = (await emulators.state<Array<{ conversationId: string }>>('msgraph', 'bot-activities'))
      .filter(reply => reply.conversationId === deniedConversation);
    expect(deniedReplies).toHaveLength(1);
    expect(JSON.stringify(deniedReplies)).toContain('Sign in to AlgaPSA');
    expect(JSON.stringify(deniedReplies)).not.toContain(ownTitle);
    expect(JSON.stringify(deniedReplies)).not.toContain(foreignTitle);


  } finally {
    await emulators.disarm('msgraph', 'operation-fault');
  }
});
