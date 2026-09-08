import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createMicrosoftProfile } from '../fixtures/microsoft-profile';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

test.use({ emulatorProviders: ['msgraph'], timezoneId: 'Europe/Berlin' });
const profileURL = '/msp/profile?tab=calendar';
type GraphEvent = { id: string; subject: string; isAllDay?: boolean; start?: { dateTime: string }; end?: { dateTime: string } };
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
  for (const fault of [
    { name: 'provider outage', status: 503, code: 'ServiceUnavailable' },
    { name: 'permission denial', status: 403, code: 'ErrorAccessDenied' },
    { name: 'throttling', status: 429, code: 'TooManyRequests' },
    { name: 'all-day throttling', status: 429, code: 'TooManyRequests' },
  ]) {
    test(`Microsoft calendar OAuth imports vendor events, exports UI edits and recovers from ${fault.name} without losing remote linkage`, async ({ page, credentials, database, emulators }, testInfo) => {
      test.setTimeout(300000);
      const allDay = fault.name === 'all-day throttling';
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

        await createMicrosoftProfile(page, { name: profileName, clientId, clientSecret, capability: 'calendar' });
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
          notificationUrl: `${process.env.E2E_CALENDAR_CALLBACK_BASE_URL || 'https://calendar-callback:3443'}/api/calendar/webhooks/microsoft`, resource: '/me/calendar/events' }));

        // Exercise outbound creation and deletion through the shipped calendar,
        // before the separate inbound event/recovery journey below.
        const outboundTitle = `@alga UI-created visit ${actors.runId}`;
        await page.goto('/msp/schedule');
        const todayColumn = page.locator('.rbc-day-slot.rbc-today');
        const noonSlot = todayColumn.locator('.rbc-time-slot').nth(24);
        await noonSlot.scrollIntoViewIfNeeded();
        const slotBounds = await noonSlot.boundingBox();
        if (!slotBounds) throw new Error('Today noon slot must be visible');
        // Click the measured viewport point. locator.click on the entire day
        // column scrolls that tall element again and invalidates slot coordinates.
        await page.mouse.click(slotBounds.x + slotBounds.width / 2, slotBounds.y + slotBounds.height / 2);
        const newEntryDialog = page.getByRole('dialog', { name: 'New Entry', exact: true });
        await newEntryDialog.locator('#title').fill(outboundTitle);
        await newEntryDialog.locator('#save-entry-btn').click();
        await expect(newEntryDialog).toBeHidden();
        await expect.poll(async () => (await database('schedule_entries').where({ ...scope, title: outboundTitle })).length).toBe(1);
        const outboundEntry = await database('schedule_entries').where({ ...scope, title: outboundTitle }).first();
        const outboundMappingScope = { ...providerScope, schedule_entry_id: outboundEntry.entry_id };
        await expect.poll(async () => (await database('calendar_event_mappings').where(outboundMappingScope)).length,
          { timeout: 60000 }).toBe(1);
        const outboundMapping = await database('calendar_event_mappings').where(outboundMappingScope).first();
        await expect.poll(async () => await emulators.state<GraphEvent[]>('msgraph', 'calendar-events'),
          { timeout: 60000 }).toEqual([expect.objectContaining({ id: outboundMapping.external_event_id, subject: outboundTitle })]);
        await page.reload();
        const outboundEvent = page.locator('.rbc-event').filter({ hasText: outboundTitle });
        await expect(outboundEvent).toHaveCount(1);
        await outboundEvent.getByText(outboundTitle, { exact: true }).click();
        await page.getByRole('dialog', { name: 'Edit Entry', exact: true }).locator('#delete-entry-btn').click();
        await page.locator(`#delete-entry-${outboundEntry.entry_id}-confirm`).click();
        await expect.poll(async () => (await database('schedule_entries').where({ ...scope, entry_id: outboundEntry.entry_id })).length,
          { timeout: 60000 }).toBe(0);
        await expect.poll(async () => await emulators.state('msgraph', 'calendar-events'), { timeout: 60000 }).toEqual([]);
        expect(await database('calendar_event_mappings').where(outboundMappingScope)).toEqual([]);
        await page.reload();
        await expect(outboundEvent).toHaveCount(0);
        const outboundHistory = await emulators.requests('msgraph');
        expect(outboundHistory.complete).toBe(true);
        expect(outboundHistory.requests).toContainEqual(expect.objectContaining({ method: 'POST', status: 201, path: '/v1.0/me/calendar/events' }));
        expect(outboundHistory.requests).toContainEqual(expect.objectContaining({ method: 'DELETE', status: 204,
          path: `/v1.0/me/calendar/events/${outboundMapping.external_event_id}` }));

        const start = new Date(); start.setUTCHours(allDay ? 0 : 12, 0, 0, 0);
        const end = new Date(start.getTime() + (allDay ? 86400000 : 3600000));
        const created = await emulators.action<CalendarChange>('msgraph', 'calendar-change', { changeType: 'created', event: {
          subject: title, body: { contentType: 'text', content: 'Customer calendar visit' },
          isAllDay: allDay,
          start: { dateTime: start.toISOString(), timeZone: 'UTC' }, end: { dateTime: end.toISOString(), timeZone: 'UTC' },
        } });
        expect(created.deliveries).toEqual([expect.objectContaining({ delivered: true, status: 200 })]);
        const mappingQuery = { ...providerScope, external_event_id: created.event.id };
        await expect.poll(async () => (await database('calendar_event_mappings').where(mappingQuery)).length, { timeout: 60000 }).toBe(1);
        const mapping = await database('calendar_event_mappings').where(mappingQuery).first();
        const entryScope = { ...scope, entry_id: mapping.schedule_entry_id };
        expect(await database('schedule_entries').where(entryScope).first()).toMatchObject({ title });
        const assertStoredDates = async () => {
          const entry = await database('schedule_entries').where(entryScope).first();
          expect(entry.is_all_day).toBe(allDay);
          expect(new Date(entry.scheduled_start).toISOString()).toBe(start.toISOString());
          expect(new Date(entry.scheduled_end).toISOString()).toBe(end.toISOString());
        };
        if (allDay) await assertStoredDates();
        await page.goto('/msp/schedule');
        const calendarEvent = (text: string) => page.locator('.rbc-event').filter({ hasText: text }).first();
        await expect(calendarEvent(title)).toBeVisible();
        if (allDay) await expect(page.locator('.rbc-event').filter({ hasText: title })).toHaveCount(1);

        // A persistent provider failure makes the local save/error/retry transition
        // observable even when multiple background handlers attempt synchronization.
        await emulators.arm('msgraph', 'operation-fault', { operation: `PATCH /me/calendar/events/${created.event.id}`,
          status: fault.status, body: { error: { code: fault.code, message: `Synthetic calendar ${fault.name}` } } });
        const editedTitle = `@alga Rescheduled visit ${actors.runId}`;
        await calendarEvent(title).getByText(title, { exact: true }).click();
        const editDialog = page.getByRole('dialog', { name: 'Edit Entry', exact: true });
        if (allDay) {
          for (const field of ['scheduled_start', 'scheduled_end']) {
            const time = editDialog.locator(`#${field}`).locator('xpath=ancestor::div[contains(@class,"dtf-fields")][1]')
              .getByRole('combobox', { name: 'Select time', exact: true });
            await expect(time).toHaveValue(/^(12:00\s*AM|00:00)$/i);
          }
        }
        await editDialog.locator('#title').fill(editedTitle);
        await editDialog.locator('#save-entry-btn').click();
        await expect(editDialog).toBeHidden();
        await expect.poll(async () => (await database('schedule_entries').where(entryScope).first())?.title).toBe(editedTitle);
        if (allDay) await assertStoredDates();
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
        if (allDay) {
          const [remote] = await emulators.state<GraphEvent[]>('msgraph', 'calendar-events');
          expect(remote.isAllDay).toBe(true);
          expect(remote.start?.dateTime.slice(0, 19)).toBe(start.toISOString().slice(0, 19));
          expect(remote.end?.dateTime.slice(0, 19)).toBe(end.toISOString().slice(0, 19));
          await assertStoredDates();
        }

        expect((await database('microsoft_calendar_provider_config').where(providerScope).first()).webhook_subscription_id)
          .toBe(config.webhook_subscription_id);
        const vendorTitle = `@alga Vendor correction ${actors.runId}`;
        const changed = await emulators.action<CalendarChange>('msgraph', 'calendar-change', { changeType: 'updated', eventId: created.event.id, event: { subject: vendorTitle } });
        expect(changed.deliveries).toEqual([expect.objectContaining({ delivered: true, status: 200 })]);
        await expect.poll(async () => (await database('schedule_entries').where(entryScope).first())?.title, { timeout: 60000 }).toBe(vendorTitle);
        await page.goto('/msp/schedule');
        await expect(calendarEvent(vendorTitle)).toBeVisible();
        if (allDay) {
          await assertStoredDates();
          await expect(page.locator('.rbc-event').filter({ hasText: vendorTitle })).toHaveCount(1);
        }
        await emulators.action('msgraph', 'calendar-change', { changeType: 'deleted', eventId: created.event.id });
        await expect.poll(async () => (await database('schedule_entries').where(entryScope)).length, { timeout: 60000 }).toBe(0);
        expect(await database('calendar_event_mappings').where(mappingQuery)).toEqual([]);
        await page.reload();
        await expect(calendarEvent(vendorTitle)).toHaveCount(0);
        expect(await emulators.state('msgraph', 'calendar-events')).toEqual([]);
        const history = await emulators.requests('msgraph');
        expect(history.complete).toBe(true);
        expect(history.requests).toContainEqual(expect.objectContaining({ method: 'PATCH', status: fault.status, path: `/v1.0/me/calendar/events/${created.event.id}` }));
        expect(history.requests).toContainEqual(expect.objectContaining({ method: 'PATCH', status: 200, path: `/v1.0/me/calendar/events/${created.event.id}` }));
        await testInfo.attach('calendar-identities', { body: JSON.stringify({ tenant: tenant.tenantId, profileId: app.profile_id,
          providerId: provider.id, scheduleEntryId: mapping.schedule_entry_id, externalEventId: created.event.id,
          fault: { name: fault.name, status: fault.status, code: fault.code } }), contentType: 'application/json' });
      } finally {
        await emulators.disarm('msgraph', 'operation-fault');
        await database('calendar_providers').where({ ...scope, provider_name: providerName }).update({ is_active: false });
      }
    });
  }
}
