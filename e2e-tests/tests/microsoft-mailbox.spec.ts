import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { simpleParser } from 'mailparser';
import { test, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createMicrosoftProfile } from '../fixtures/microsoft-profile';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

test.use({ emulatorProviders: ['msgraph'] });
type CapturedMail = { payload: string; contentType: string };

test('Microsoft mailbox OAuth receives a ticket, sends a UI reply through Graph and deduplicates callbacks', async ({ page, credentials, database, emulators }, testInfo) => {
  test.setTimeout(300000);
  if (process.env.E2E_EMAIL_TRANSPORT_ISOLATED !== 'true') {
    throw new Error('Microsoft mailbox journeys require an owned email-service and Redis stack');
  }
  const actors = await createProductionBrowserActors(database, { sourceEmail: credentials.email });
  const tenant = actors.primary;
  const scope = { tenant: tenant.tenantId };
  // The Graph emulator currently models one authorized mailbox per reset.
  const mailbox = 'support@example.test';
  const name = `Microsoft mailbox ${actors.runId}`;
  const title = `Microsoft inbound ticket ${actors.runId}`;
  const body = `Please investigate the customer connection ${actors.runId}`;
  const defaultsName = `Microsoft defaults ${actors.runId}`;
  const clientId = randomUUID();
  const clientSecret = `synthetic-mail-${actors.runId}`;
  await database('inbound_ticket_defaults').insert({
    id: randomUUID(), ...scope, short_name: `ms-${actors.runId}`, display_name: defaultsName,
    is_default: true, is_active: true, board_id: tenant.ticketing.boardId,
    status_id: tenant.ticketing.openStatusId, priority_id: tenant.ticketing.priorityId,
    client_id: tenant.clients.primary.id, entered_by: tenant.admin.userId,
  });
  await emulators.seed('msgraph', 'client', { clientId, clientSecret });
  try {
    await signIn(page, { email: tenant.admin.email, password: credentials.password });
    await createMicrosoftProfile(page, { name, clientId, clientSecret, capability: 'email' });
    const profile = await database('microsoft_profiles').where({ ...scope, display_name: name }).first();
    expect(profile).toMatchObject({ client_id: clientId });
    await page.goto('/msp/settings/integrations?category=communication');
    await page.locator('#add-provider-btn').click();
    await page.locator('#setup-microsoft-provider-button').click();
    const dialog = page.getByRole('dialog', { name: 'Microsoft 365 Configuration', exact: true });
    await dialog.locator('#providerName').fill(name);
    await dialog.locator('#mailbox').fill(mailbox);
    await dialog.locator('#microsoft-inbound-defaults-select').click();
    await page.getByRole('option', { name: defaultsName, exact: true }).click();
    await dialog.locator(`#microsoft-issuer-option-profile-${profile.profile_id}`).click();
    const popupPromise = page.waitForEvent('popup');
    await dialog.locator('#oauth-authorize-btn').click();
    const popup = await popupPromise;
    await expect(dialog.locator('#oauth-authorize-btn')).toHaveText('Authorized', { timeout: 60000 });
    if (!popup.isClosed()) await popup.waitForEvent('close', { timeout: 30000 });
    await dialog.locator('#submit-btn').click();
    await expect(dialog).toBeHidden();
    const providers = await database('email_providers').where({ ...scope, provider_name: name });
    expect(providers).toHaveLength(1);
    const provider = providers[0];
    expect(provider).toMatchObject({ provider_type: 'microsoft', mailbox, is_active: true, status: 'connected' });
    const configWhere = { ...scope, email_provider_id: provider.id };
    await expect.poll(async () => (await database('microsoft_email_provider_config').where(configWhere).first())?.delivery_mode,
      { timeout: 30000 }).toBe('webhook');
    const config = await database('microsoft_email_provider_config').where(configWhere).first();
    expect(await emulators.state('msgraph', 'subscriptions')).toContainEqual(expect.objectContaining({
      id: config.webhook_subscription_id, notificationUrl: 'https://calendar-callback:3443/api/email/webhooks/microsoft',
    }));

    await page.goto('/msp/settings/email');
    await page.getByRole('tab', { name: 'Outbound Email', exact: true }).click();
    const enterprise = process.env.E2E_EDITION === 'enterprise';
    await page.locator(enterprise ? '#outbound-provider-select' : '#provider-select').click();
    await page.getByRole('option', { name: 'Microsoft 365 (Microsoft Graph)', exact: true }).click();
    await page.locator('#microsoft-outbound-mailbox').click();
    await page.getByRole('option', { name: `${name} — ${mailbox}`, exact: true }).click();
    await page.locator('#ticket-from-inbox').click();
    await page.getByRole('option', { name: mailbox, exact: true }).click();
    await page.locator(enterprise ? '#save-sender-identities' : '#save-email-settings').click();
    await expect.poll(async () => database('tenant_email_settings').where(scope).first())
      .toMatchObject({ email_provider: 'microsoft', ticketing_from_email: mailbox });

    // Fetching the message and processing the durable pointer happen in the
    // shipped email worker; no direct ticket creation or adapter interception.
    const message = await emulators.seed<{ id: string }>('msgraph', 'message', {
      subject: title, body, from: tenant.portal.email, to: mailbox,
      authenticationResults: `graph-emulator; spf=pass smtp.mailfrom=${tenant.portal.email.split('@')[1]}; dkim=pass header.d=${tenant.portal.email.split('@')[1]}`,
    });
    await expect.poll(async () => (await database('tickets').where({ ...scope, title })).length,
      { timeout: 120000, intervals: [1000, 2000] }).toBe(1);
    const ticket = await database('tickets').where({ ...scope, title }).first();
    expect(ticket).toMatchObject({ client_id: tenant.clients.primary.id, contact_name_id: tenant.portal.contactId,
      board_id: tenant.ticketing.boardId, status_id: tenant.ticketing.openStatusId });
    await page.goto(`/msp/tickets/${ticket.ticket_id}`);
    await expect(page.locator('#ticket-details-bento-hero-description-section').getByText(body, { exact: true })).toBeVisible();
    await expect.poll(async () => (await database('email_processed_messages')
      .where({ ...scope, provider_id: provider.id, processing_status: 'success' })).length).toBe(1);

    // Expire both the stored deadline and the provider-side token so cached
    // adapters must also recover through a real token exchange.
    await database('microsoft_email_provider_config').where(configWhere).update({ token_expires_at: new Date(0) });
    await emulators.action('msgraph', 'expire-access-tokens');
    const reply = `Microsoft agent response ${actors.runId}`;
    const conversation = page.locator('#ticket-details-bento-timeline-tile');
    await conversation.getByRole('button', { name: 'Add Comment', exact: true }).click();
    await conversation.getByRole('group', { name: 'Reply visibility' }).getByRole('button', { name: 'Client', exact: true }).click();
    await conversation.locator('[contenteditable="true"]:visible').fill(reply);
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation.getByText(reply, { exact: true })).toBeVisible();
    const replies = async () => {
      const captures = await emulators.state<CapturedMail[]>('msgraph', 'send-mails');
      const messages = await Promise.all(captures.map(async capture => {
        expect(capture.contentType).toBe('text/plain');
        expect(typeof capture.payload).toBe('string');
        return simpleParser(Buffer.from(capture.payload, 'base64'));
      }));
      return messages.filter(mail => (mail.text || '').includes(reply)
        && [mail.to].flat().some(addresses => addresses?.value.some(address => address.address === tenant.portal.email)));
    };
    await expect.poll(async () => (await replies()).length, { timeout: 90000 }).toBe(1);
    await expect.poll(async () => new Date((await database('microsoft_email_provider_config').where(configWhere).first())?.token_expires_at).getTime()).toBeGreaterThan(Date.now());

    const snapshot = async () => ({
      tickets: await database('tickets').where(scope).orderBy('ticket_id').pluck('ticket_id'),
      comments: await database('comments').where({ ...scope, ticket_id: ticket.ticket_id }).orderBy('comment_id').select('comment_id', 'note'),
      messages: await database('email_processed_messages').where({ ...scope, provider_id: provider.id }).orderBy('message_id').pluck('message_id'),
    });
    const beforeReplay = await snapshot();
    const queue = createClient({ socket: { host: process.env.E2E_REDIS_HOST || '127.0.0.1',
      port: Number(process.env.E2E_REDIS_PORT || '6379'), connectTimeout: 5000, reconnectStrategy: false },
      password: process.env.E2E_REDIS_PASSWORD || undefined });
    queue.on('error', error => console.error('Mailbox replay queue:', error.message));
    try {
      await queue.connect();
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await emulators.action<{ deliveries: Array<{ status: number; delivered: boolean }> }>('msgraph', 'deliver-message', { messageId: message.id });
        expect(result.deliveries).toEqual([expect.objectContaining({ status: 200, delivered: true })]);
      }
      await expect.poll(async () => {
        const [ready, processing, deadLetters, inflight, leases] = await queue.multi()
          .lRange('email:inbound:unified:pointer:ready', 0, -1)
          .lRange('email:inbound:unified:pointer:processing', 0, -1)
          .lRange('email:inbound:unified:pointer:dlq', 0, -1)
          .hVals('email:inbound:unified:pointer:inflight')
          .zRange('email:inbound:unified:pointer:lease', 0, -1).exec();
        const owned = (value: string) => value.includes(message.id) || value.includes(provider.id);
        return { deadLetters: (deadLetters as string[]).filter(owned),
          pending: [...ready as string[], ...processing as string[], ...inflight as string[], ...leases as string[]].filter(owned).length };
      }, { timeout: 30000 }).toEqual({ deadLetters: [], pending: 0 });
      expect(await snapshot()).toEqual(beforeReplay);
      expect(await replies()).toHaveLength(1);
    } finally { if (queue.isOpen) await queue.quit(); }
    await page.reload();
    await expect(page.getByText(reply, { exact: true })).toBeVisible();
    const history = await emulators.requests('msgraph');
    expect(history.complete).toBe(true);
    expect(history.requests).toContainEqual(expect.objectContaining({ method: 'POST', path: '/v1.0/me/sendMail', status: 202 }));
    await testInfo.attach('microsoft-mailbox-identities', { body: JSON.stringify({ tenantId: tenant.tenantId,
      providerId: provider.id, messageId: message.id, ticketId: ticket.ticket_id }), contentType: 'application/json' });
  } finally {
    await database('email_providers').where({ ...scope, provider_name: name }).update({ is_active: false });
  }
});
