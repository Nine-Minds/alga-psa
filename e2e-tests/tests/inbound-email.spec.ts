import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { createClient } from 'redis';
import { test, expect } from '../fixtures/emulators';
import { signIn } from '../fixtures/auth';
import { createProductionBrowserActors } from '../../server/test-utils/productionBrowserFixtures';

test.use({ emulatorProviders: ['smtp-sink'] });

test('built email service ingests MIME, preserves inline quotations, threads replies and deduplicates delivery', async ({ page, credentials, database, emulators }, testInfo) => {
  test.setTimeout(300_000);
  if (process.env.E2E_EMAIL_TRANSPORT_ISOLATED !== 'true') {
    throw new Error('Raw email journeys require E2E_EMAIL_TRANSPORT_ISOLATED=true and an owned GreenMail/email-service stack');
  }
  // This tenant belongs to this scenario, even when other specs share the
  // worker. Exact ticket/document counts must not depend on file order.
  const actors = await createProductionBrowserActors(database, { sourceEmail: credentials.email });
  const tenant = actors.primary;
  const mailbox = `inbound-${actors.runId}@example.test`;
  const title = `Raw MIME transport ${actors.runId}`;
  const defaultsName = `Inbound ${actors.runId}`;
  await database('inbound_ticket_defaults').insert({
    id: randomUUID(), tenant: tenant.tenantId, short_name: `inbound-${actors.runId}`,
    display_name: defaultsName, is_default: true, is_active: true,
    board_id: tenant.ticketing.boardId, status_id: tenant.ticketing.openStatusId,
    priority_id: tenant.ticketing.priorityId, client_id: tenant.clients.primary.id,
    entered_by: tenant.admin.userId,
  });
  await database('tenant_email_settings').insert({
    tenant: tenant.tenantId, email_provider: 'smtp', fallback_enabled: false,
    ticketing_from_email: mailbox,
    provider_configs: JSON.stringify([{ providerId: 'smtp-e2e', providerType: 'smtp', isEnabled: true,
      config: { host: 'algasim', port: 4040, secure: false, from: mailbox,
        username: '', password: '', requireTLS: false } }]),
  });

  await signIn(page, { email: tenant.admin.email, password: credentials.password });
  await page.goto('/msp/settings/integrations?category=communication');
  await page.locator('#add-provider-btn').click();
  await page.locator('#setup-imap-provider-button').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#providerName').fill(title);
  await dialog.locator('#mailbox').fill(mailbox);
  await dialog.locator('#host').fill('imap-test-server');
  await dialog.locator('#port').fill('3143');
  await dialog.locator('#secure').click();
  await dialog.locator('#username').fill(mailbox);
  await dialog.locator('#password').fill('synthetic-mailbox-password');
  await dialog.locator('#imap-defaults-select').click();
  await page.getByRole('option', { name: defaultsName, exact: true }).click();
  await dialog.getByRole('button', { name: 'Create Provider', exact: true }).click();
  await expect(dialog).toBeHidden();
  const providers = await database('email_providers').where({ tenant: tenant.tenantId, mailbox });
  expect(providers).toHaveLength(1);
  const provider = providers[0];
  expect(provider).toMatchObject({ provider_type: 'imap', is_active: true, inbound_paused_at: null });

  const transport = nodemailer.createTransport({
    host: process.env.E2E_SMTP_HOST || '127.0.0.1', port: Number(process.env.E2E_SMTP_PORT || '3025'),
    secure: false, ignoreTLS: true, connectionTimeout: 10_000, socketTimeout: 10_000,
  });
  const firstId = `<new-${actors.runId}@example.test>`;
  const inlineQuote = `Keep this customer quotation ${actors.runId}`;
  const firstBody = `Investigate the connection ${actors.runId}`;
  const boundary = `mime-${actors.runId}`;
  const raw = [
    `From: Customer <${tenant.portal.email}>`, `To: ${mailbox}`, `Subject: ${title}`,
    `Message-ID: ${firstId}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0',
    // Model the receiving provider's authentication result; GreenMail itself
    // does not implement Internet SPF/DKIM/DMARC verification.
    'Authentication-Results: imap-test-server; dmarc=pass header.from=example.invalid; spf=pass smtp.mailfrom=example.invalid; dkim=pass header.d=example.invalid',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/html; charset=utf-8', '',
    `<p>${firstBody}</p><blockquote>${inlineQuote}</blockquote><p>My answer follows the quotation.</p>`,
    `--${boundary}`, 'Content-Type: text/plain; name="diagnostic.txt"',
    'Content-Disposition: attachment; filename="diagnostic.txt"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(`Attachment bytes ${actors.runId}`).toString('base64'), `--${boundary}--`, '',
  ].join('\r\n');
  async function send(message: string) {
    const result = await transport.sendMail({ envelope: { from: tenant.portal.email, to: [mailbox] }, raw: message });
    expect(result.accepted).toEqual([mailbox]);
    expect(result.rejected).toEqual([]);
  }
  try {
    await send(raw);
    await expect.poll(async () => (await database('tickets').where({ tenant: tenant.tenantId, title })).length,
      { timeout: 120_000, intervals: [1000, 2000] }).toBe(1);
    const ticket = await database('tickets').where({ tenant: tenant.tenantId, title }).first();
    expect(ticket).toMatchObject({ client_id: tenant.clients.primary.id, contact_name_id: tenant.portal.contactId,
      board_id: tenant.ticketing.boardId, status_id: tenant.ticketing.openStatusId });
    await page.goto(`/msp/tickets/${ticket.ticket_id}`);
    const description = page.locator('#ticket-details-bento-hero-description-section');
    await expect(description.getByText(firstBody, { exact: true })).toBeVisible();
    await expect(description.getByText(inlineQuote, { exact: true })).toBeVisible();
    const ticketWhere = { tenant: tenant.tenantId, ticket_id: ticket.ticket_id };
    await expect.poll(async () => (await database('email_processed_messages')
      .where({ tenant: tenant.tenantId, provider_id: provider.id }).first())?.processing_status).toBe('success');
    const attachments = await database('documents as d')
      .join('document_associations as a', function () {
        this.on('a.tenant', '=', 'd.tenant').andOn('a.document_id', '=', 'd.document_id');
      }).where({ 'd.tenant': tenant.tenantId, 'a.entity_id': ticket.ticket_id, 'd.document_name': 'diagnostic.txt' })
      .select('d.file_id');
    expect(attachments).toHaveLength(1);
    const download = await page.request.get(`/api/documents/download/${attachments[0].file_id}`);
    expect(download.status()).toBe(200);
    expect(await download.body()).toEqual(Buffer.from(`Attachment bytes ${actors.runId}`));

    const agentReply = `Agent transport response ${actors.runId}`;
    const conversation = page.locator('#ticket-details-bento-timeline-tile');
    await conversation.getByRole('button', { name: 'Add Comment', exact: true }).click();
    await conversation.getByRole('group', { name: 'Reply visibility' }).getByRole('button', { name: 'Client', exact: true }).click();
    await conversation.locator('[contenteditable="true"]:visible').fill(agentReply);
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation.getByText(agentReply, { exact: true })).toBeVisible();
    type CapturedMail = { to: string[]; text: string; messageId: string; inReplyTo: string; references: string[] };
    const replies = async () => (await emulators.state<CapturedMail[]>('smtp-sink', 'emails'))
      .filter(mail => mail.to.includes(tenant.portal.email) && mail.text.includes(agentReply));
    await expect.poll(async () => (await replies()).length, { timeout: 90_000 }).toBe(1);
    const outbound = (await replies())[0];
    const normalizedId = (id: string) => id.replace(/^<|>$/g, '');
    const chain = await emulators.state<CapturedMail[]>('smtp-sink', 'emails');
    const parent = chain.find(mail => mail.messageId && normalizedId(mail.messageId) === normalizedId(outbound.inReplyTo));
    // Alga replies to the latest outbound message in the ticket thread, which
    // can be the acknowledgment. Its References must retain the inbound root.
    if (normalizedId(outbound.inReplyTo) !== normalizedId(firstId)) {
      expect(parent, 'Reply parent must be a captured message from this ticket thread').toBeDefined();
      expect(parent!.references.map(normalizedId)).toContain(normalizedId(firstId));
    }
    expect(outbound.references.map(normalizedId)).toContain(normalizedId(firstId));
    expect(outbound.messageId).toEqual(expect.any(String));

    const customerReply = `Customer confirms recovery ${actors.runId}`;
    const oldHistory = `Obsolete quoted history ${actors.runId}`;
    const replyId = `<reply-${actors.runId}@example.test>`;
    await send([
      `From: Customer <${tenant.portal.email}>`, `To: ${mailbox}`, `Subject: Re: ${title}`,
      `Message-ID: ${replyId}`, `In-Reply-To: ${outbound.messageId}`,
      `References: ${firstId} ${outbound.messageId}`, `Date: ${new Date().toUTCString()}`,
      'Authentication-Results: imap-test-server; spf=pass smtp.mailfrom=example.invalid; dkim=pass header.d=example.invalid',
      'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
      `<p>${customerReply}</p><div class="gmail_quote"><div class="gmail_attr">On Sun, Sep 6, 2026 at 12:00 PM Support wrote:</div><blockquote class="gmail_quote">${oldHistory}</blockquote></div>`, '',
    ].join('\r\n'));
    await expect.poll(async () => (await database('comments').where(ticketWhere))
      .filter(comment => comment.note?.includes(customerReply)).length, { timeout: 60_000 }).toBe(1);
    expect(await database('tickets').where({ tenant: tenant.tenantId }).count('* as count').first())
      .toMatchObject({ count: '1' });
    await page.reload();
    await expect(page.getByText(customerReply, { exact: true })).toBeVisible();
    await expect(page.getByText(oldHistory, { exact: true })).toHaveCount(0);
    await expect(description.getByText(inlineQuote, { exact: true })).toBeVisible();
    await expect.poll(async () => (await database('email_processed_messages')
      .where({ tenant: tenant.tenantId, provider_id: provider.id, processing_status: 'success' })).length).toBe(2);

    // Redeliver each real IMAP pointer over the shipped webhook. Keep the
    // original UID and MIME bytes: a different SMTP delivery has a different
    // provider identity and Received header, and is not a queue replay.
    const processed = await database('email_processed_messages')
      .where({ tenant: tenant.tenantId, provider_id: provider.id }).orderBy('message_id');
    const snapshot = async () => ({
      tickets: await database('tickets').where({ tenant: tenant.tenantId }).orderBy('ticket_id').pluck('ticket_id'),
      comments: await database('comments').where(ticketWhere).orderBy('comment_id').select('comment_id', 'note'),
      documents: await database('documents').where({ tenant: tenant.tenantId }).orderBy('document_id').pluck('document_id'),
      messages: await database('email_processed_messages').where({ tenant: tenant.tenantId, provider_id: provider.id })
        .orderBy('message_id').pluck('message_id'),
    });
    const beforeReplay = await snapshot();
    const queue = createClient({ socket: { host: process.env.E2E_REDIS_HOST || '127.0.0.1',
      port: Number(process.env.E2E_REDIS_PORT || '6379'), connectTimeout: 5000, reconnectStrategy: false },
      password: process.env.E2E_REDIS_PASSWORD || undefined });
    queue.on('error', error => console.error('Email test queue connection:', error.message));
    try {
      await queue.connect();
      const replayJobIds: string[] = [];
      for (const message of processed) {
        const metadata = typeof message.metadata === 'string' ? JSON.parse(message.metadata) : message.metadata;
        const result = await page.request.post('/api/email/webhooks/imap', {
          headers: { 'x-imap-webhook-secret': 'regression-imap-only' },
          data: { providerId: provider.id, tenantId: tenant.tenantId, pointer: metadata.pointer },
        });
        expect(result.status()).toBe(200);
        const receipt = await result.json();
        expect(receipt).toMatchObject({ success: true, queued: true, handoff: 'unified_pointer_queue' });
        expect(receipt.jobId).toEqual(expect.any(String));
        replayJobIds.push(receipt.jobId);
      }
      const matchesReplay = (value: string) => replayJobIds.some(id => value.includes(id));
      await expect.poll(async () => {
        const [ready, processing, deadLetters, inflight, leases] = await queue.multi()
          .lRange('email:inbound:unified:pointer:ready', 0, -1)
          .lRange('email:inbound:unified:pointer:processing', 0, -1)
          .lRange('email:inbound:unified:pointer:dlq', 0, -1)
          .hVals('email:inbound:unified:pointer:inflight')
          .zRange('email:inbound:unified:pointer:lease', 0, -1).exec();
        return { deadLetters: (deadLetters as string[]).filter(matchesReplay),
          pending: [...ready as string[], ...processing as string[], ...leases as string[],
            ...inflight as string[]].filter(matchesReplay).length };
      }, { timeout: 30_000 }).toEqual({ deadLetters: [], pending: 0 });
      expect(await snapshot()).toEqual(beforeReplay);
      expect(await replies()).toHaveLength(1);
      await testInfo.attach('inbound-replay-jobs', { body: JSON.stringify(replayJobIds), contentType: 'application/json' });
    } finally { if (queue.isOpen) await queue.quit(); }
    await testInfo.attach('inbound-identities', { body: JSON.stringify({ providerId: provider.id,
      tenantId: tenant.tenantId, ticketId: ticket.ticket_id, firstId }), contentType: 'application/json' });
  } finally {
    transport.close();
    // Stop ingestion before the next test gets its own mailbox and provider.
    await database('email_providers').where({ tenant: tenant.tenantId, id: provider.id }).update({ is_active: false });
  }
});
