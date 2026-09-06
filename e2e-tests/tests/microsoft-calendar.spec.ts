import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

test.use({ emulatorProviders: ['msgraph'] });
const profileURL = '/msp/profile?tab=calendar';
type GraphEvent = { id: string; subject: string };
type CalendarChange = { event: GraphEvent; deliveries: Array<{ delivered: boolean; status: number | null }> };

if (process.env.E2E_EDITION !== 'enterprise') {
  test('community does not expose personal calendar integration settings', async ({ page, credentials }) => {
    await signIn(page, credentials);
    await page.goto(profileURL);
    await expect(page.getByRole('tab', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toHaveCount(0);
    await expect(page.locator('#add-outlook-calendar-button-empty')).toHaveCount(0);
  });
} else {
  test('Microsoft calendar OAuth imports vendor events, exports UI edits and recovers without losing remote linkage', async ({ page, credentials, database, emulators }, testInfo) => {
    test.setTimeout(300000);
    const actors = await createProductionBrowserActors(database, { sourceEmail: credentials.email });
    const tenant = actors.primary;
    const scope = { tenant: tenant.tenantId };
    const clientId = randomUUID();
    const clientSecret = `synthetic-calendar-${actors.runId}`;
    const profileName = `Calendar app ${actors.runId}`;
    const providerName = `Outlook ${actors.runId}`;
    const title = `@alga Calendar visit ${actors.runId}`;
    await emulators.seed('msgraph', 'client', { clientId, clientSecret });
    try {
      await signIn(page, { email: tenant.admin.email, password: credentials.password });

      await page.goto('/msp/settings?tab=integrations&category=providers');
      await page.locator('#provider-credentials-microsoft-tab').click();
      await page.locator('#microsoft-advanced-app-toggle').click();
      await page.locator('#microsoft-settings-add-profile').click();
      const appDialog = page.getByRole('dialog');
      await appDialog.locator('#microsoft-profile-display-name').fill(profileName);
      await appDialog.locator('#microsoft-profile-client-id').fill(clientId);
      await appDialog.locator('#microsoft-profile-client-secret').fill(clientSecret);
      await appDialog.locator('#microsoft-profile-tenant-id').fill('common');
      for (const capability of ['msp_sso', 'email', 'teams']) {
        const checkbox = appDialog.locator(`#microsoft-profile-capability-${capability}`);
        if (await checkbox.count()) await checkbox.uncheck();
      }
      await appDialog.locator('#microsoft-profile-capability-calendar').check();
      await appDialog.locator('#microsoft-profile-save').click();
      await expect(appDialog).toBeHidden();
      await page.locator('#microsoft-binding-select-calendar').click();
      await page.getByRole('option', { name: profileName, exact: true }).click();
      const app = await database('microsoft_profiles').where({ ...scope, display_name: profileName }).first();
      expect(app).toMatchObject({ client_id: clientId });
      await expect.poll(async () => (await database('microsoft_profile_consumer_bindings')
        .where({ ...scope, consumer_type: 'calendar' }).first())?.profile_id).toBe(app.profile_id);

      await page.goto(profileURL);
      await page.locator('#add-outlook-calendar-button-empty').click();
      const providerDialog = page.getByRole('dialog', { name: 'Add Microsoft Calendar Provider', exact: true });
      await providerDialog.locator('#microsoft-provider-name-input').fill(providerName);
      const popupPromise = page.waitForEvent('popup');
      await providerDialog.locator('#microsoft-authorize-button').click();
      const popup = await popupPromise;
      await expect(providerDialog).toBeHidden({ timeout: 60000 });
      if (!popup.isClosed()) await popup.waitForEvent('close', { timeout: 30000 });
      await page.reload();
      await expect(page.locator('#calendar-provider-0-name')).toHaveText(providerName);
      const provider = await database('calendar_providers').where({ ...scope, provider_name: providerName }).first();
      expect(provider).toMatchObject({ provider_type: 'microsoft', user_id: tenant.admin.userId, status: 'connected' });
      const providerScope = { ...scope, calendar_provider_id: provider.id };
      await expect.poll(async () => (await database('microsoft_calendar_provider_config').where(providerScope).first())?.webhook_subscription_id,
        { timeout: 30000 }).toEqual(expect.any(String));
      const config = await database('microsoft_calendar_provider_config').where(providerScope).first();
      const subscriptions = await emulators.state<Array<{ id: string; notificationUrl: string; resource: string }>>('msgraph', 'subscriptions');
      expect(subscriptions).toContainEqual(expect.objectContaining({ id: config.webhook_subscription_id,
        notificationUrl: 'https://calendar-callback:3443/api/calendar/webhooks/microsoft', resource: '/me/calendar/events' }));

      const start = new Date(); start.setUTCHours(12, 0, 0, 0);
      const end = new Date(start.getTime() + 3600000);
      const created = await emulators.action<CalendarChange>('msgraph', 'calendar-change', { changeType: 'created', event: {
        subject: title, body: { contentType: 'text', content: 'Customer calendar visit' },
        start: { dateTime: start.toISOString(), timeZone: 'UTC' }, end: { dateTime: end.toISOString(), timeZone: 'UTC' },
      } });
      expect(created.deliveries).toEqual([expect.objectContaining({ delivered: true, status: 200 })]);
      const mappingQuery = { ...providerScope, external_event_id: created.event.id };
      await expect.poll(async () => (await database('calendar_event_mappings').where(mappingQuery)).length, { timeout: 60000 }).toBe(1);
      const mapping = await database('calendar_event_mappings').where(mappingQuery).first();
      const entryScope = { ...scope, entry_id: mapping.schedule_entry_id };
      expect(await database('schedule_entries').where(entryScope).first()).toMatchObject({ title });
      await page.goto('/msp/schedule');
      const calendarEvent = (text: string) => page.locator('.rbc-event').filter({ hasText: text }).first();
      await expect(calendarEvent(title)).toBeVisible();

      // A persistent provider failure makes the local save/error/retry transition
      // observable even when multiple background handlers attempt synchronization.
      await emulators.arm('msgraph', 'operation-fault', { operation: `PATCH /me/calendar/events/${created.event.id}`,
        status: 503, body: { error: { code: 'ServiceUnavailable', message: 'Calendar temporarily unavailable' } } });
      const editedTitle = `@alga Rescheduled visit ${actors.runId}`;
      await calendarEvent(title).getByText(title, { exact: true }).click();
      const editDialog = page.getByRole('dialog', { name: 'Edit Entry', exact: true });
      await editDialog.locator('#title').fill(editedTitle);
      await editDialog.locator('#save-entry-btn').click();
      await expect(editDialog).toBeHidden();
      await expect.poll(async () => (await database('schedule_entries').where(entryScope).first())?.title).toBe(editedTitle);
      await expect.poll(async () => (await database('calendar_providers').where({ ...scope, id: provider.id }).first())?.status,
        { timeout: 60000 }).toBe('error');
      expect(await emulators.state<GraphEvent[]>('msgraph', 'calendar-events')).toEqual([expect.objectContaining({ id: created.event.id, subject: title })]);
      await page.goto(profileURL);
      await expect(page.locator('#calendar-provider-0-status-error')).toBeVisible();

      await emulators.disarm('msgraph', 'operation-fault');
      // Expire the stored deadline without replacing credentials or token HTTP.
      // The retry must refresh through the configured Microsoft profile.
      await database('microsoft_calendar_provider_config').where(providerScope).update({ token_expires_at: new Date(0) });
      await page.locator('#calendar-provider-0-sync-button').click();
      await expect.poll(async () => (await emulators.state<GraphEvent[]>('msgraph', 'calendar-events'))[0]?.subject,
        { timeout: 60000 }).toBe(editedTitle);
      await expect.poll(async () => (await database('calendar_providers').where({ ...scope, id: provider.id }).first())?.status,
        { timeout: 60000 }).toBe('connected');
      expect(await database('calendar_event_mappings').where(mappingQuery).select('id', 'schedule_entry_id'))
        .toEqual([{ id: mapping.id, schedule_entry_id: mapping.schedule_entry_id }]);
      expect(await emulators.state<GraphEvent[]>('msgraph', 'calendar-events')).toEqual([expect.objectContaining({ id: created.event.id })]);

      const vendorTitle = `@alga Vendor correction ${actors.runId}`;
      await emulators.action('msgraph', 'calendar-change', { changeType: 'updated', eventId: created.event.id, event: { subject: vendorTitle } });
      await expect.poll(async () => (await database('schedule_entries').where(entryScope).first())?.title, { timeout: 60000 }).toBe(vendorTitle);
      await page.goto('/msp/schedule');
      await expect(calendarEvent(vendorTitle)).toBeVisible();
      await emulators.action('msgraph', 'calendar-change', { changeType: 'deleted', eventId: created.event.id });
      await expect.poll(async () => (await database('schedule_entries').where(entryScope)).length, { timeout: 60000 }).toBe(0);
      expect(await database('calendar_event_mappings').where(mappingQuery)).toEqual([]);
      await page.reload();
      await expect(calendarEvent(vendorTitle)).toHaveCount(0);
      expect(await emulators.state('msgraph', 'calendar-events')).toEqual([]);
      const history = await emulators.requests('msgraph');
      expect(history.complete).toBe(true);
      expect(history.requests).toContainEqual(expect.objectContaining({ method: 'PATCH', status: 503, path: `/v1.0/me/calendar/events/${created.event.id}` }));
      await testInfo.attach('calendar-identities', { body: JSON.stringify({ tenant: tenant.tenantId, profileId: app.profile_id,
        providerId: provider.id, scheduleEntryId: mapping.schedule_entry_id, externalEventId: created.event.id }), contentType: 'application/json' });
    } finally {
      await emulators.disarm('msgraph', 'operation-fault');
      await database('calendar_providers').where({ ...scope, provider_name: providerName }).update({ is_active: false });
    }
  });
}
